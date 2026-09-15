/**
 * Bakes the ResiliNet terrain assets from open data. Run with:
 *
 *   npm run bake:terrain
 *
 * Sources (all fetched once, at build time, and cached in .cache/):
 *   - Elevation: NASA SRTM 1 arc-second (~30 m) void-filled tiles, served as
 *     Skadi .hgt.gz from the AWS Open Data "elevation-tiles-prod" bucket.
 *   - Surface imagery: EOX Sentinel-2 cloudless (ESA Copernicus, ~10 m),
 *     CC BY 4.0.
 *   - Roads, railway, settlements, residential areas and buildings:
 *     OpenStreetMap via Overpass, ODbL.
 *
 * Outputs into public/terrain/:
 *   elevation.bin  Int16 little-endian metres, row-major, north row first
 *   hand.bin       Uint8 decimetres of Height Above Nearest Drainage, 255 = dry
 *   surface.jpg    Sentinel-2 mosaic reprojected to the AOI's mercator box
 *   houses.bin     Float32 little-endian [lon, lat, heading] per home
 *   roads.json     junction-preserving road + rail graph: nodes and edges
 *                  with drawn geometry, length and minimum HAND
 *   terrain.json   grid metadata, attribution, settlements, depot, tower
 *                  candidates, existing network sites
 *
 * Homes are OSM building footprints where they exist; elsewhere they are
 * illustrative houses filling OSM residential areas and clustered around
 * OSM settlement nodes, so a village reads as a village even where the map
 * has no individual buildings. The count per settlement is therefore an
 * indication of scale, not a census.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import sharp from 'sharp';

// Area of interest: the Sungai Galas valley in Kelantan, from Gunung Stong and
// Dabong in the south-west to the Galas–Lebir confluence at Kuala Krai. The
// box straddles 102 °E, so it spans two SRTM tiles.
const AOI = { west: 101.88, east: 102.28, south: 5.26, north: 5.6 };
const SRTM_SPAN = 3601; // 1 arc-second samples per degree tile, inclusive edge
const IMAGERY_ZOOM = 14;
const TEXTURE_SIZE = 4096;
const MESH_STEP = 2; // downsample factor from the 30 m analysis grid
// Upstream cells (~11 km²) before a cell counts as drainage. Kept high so the
// mountain ravines on Stong do not register as channels that fill with water.
const DRAINAGE_CELLS = 12000;
const HAND_CAP_DM = 254; // 25.4 m, well above any modelled flood level

const CACHE = path.resolve('.cache');
const OUT = path.resolve('public/terrain');

const log = (...args) => console.log('[bake]', ...args);

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination, init) {
  if (await exists(destination)) return destination;
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  return destination;
}

// --- Elevation -------------------------------------------------------------

/** The 1°x1° Skadi tiles that cover the AOI (northern/eastern hemisphere). */
function srtmTiles() {
  const tiles = [];
  for (let lat = Math.floor(AOI.south); lat < AOI.north; lat += 1) {
    for (let lon = Math.floor(AOI.west); lon < AOI.east; lon += 1) {
      const name = `N${String(lat).padStart(2, '0')}E${String(lon).padStart(3, '0')}`;
      tiles.push({ lat, lon, name });
    }
  }
  return tiles;
}

async function loadSrtm() {
  const tiles = [];
  for (const tile of srtmTiles()) {
    const hgt = path.join(CACHE, `${tile.name}.hgt`);
    if (!(await exists(hgt))) {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${tile.name.slice(0, 3)}/${tile.name}.hgt.gz`;
      log('downloading SRTM', url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`SRTM ${response.status}`);
      await mkdir(CACHE, { recursive: true });
      await pipeline(
        Readable.fromWeb(response.body),
        createGunzip(),
        createWriteStream(hgt),
      );
    }
    const buffer = await readFile(hgt);
    log('SRTM tile loaded', tile.name, buffer.length, 'bytes');
    tiles.push({ ...tile, buffer });
  }
  return tiles;
}

/**
 * Crop the AOI out of the tile set at native 1 arc-second resolution. Cells
 * are addressed in global arc-seconds (x east from Greenwich, y south from
 * the equator) and read from whichever tile contains them; the shared edge
 * sample is identical in neighbouring tiles.
 */
function cropAoi(tiles) {
  const col0 = Math.round(AOI.west * 3600);
  const col1 = Math.round(AOI.east * 3600);
  const row0 = Math.round(-AOI.north * 3600);
  const row1 = Math.round(-AOI.south * 3600);
  const width = col1 - col0;
  const height = row1 - row0;
  const elevation = new Int16Array(width * height);
  const byCorner = new Map(
    tiles.map((tile) => [`${tile.lat},${tile.lon}`, tile.buffer]),
  );

  const colTileLon = new Int32Array(width);
  const colInTile = new Int32Array(width);
  for (let col = 0; col < width; col += 1) {
    const gx = col0 + col;
    colTileLon[col] = Math.floor(gx / 3600);
    colInTile[col] = gx - colTileLon[col] * 3600;
  }

  for (let row = 0; row < height; row += 1) {
    const gy = row0 + row;
    const tileLat = Math.ceil(-gy / 3600) - 1;
    const rowInTile = gy + (tileLat + 1) * 3600;
    for (let col = 0; col < width; col += 1) {
      const buffer = byCorner.get(`${tileLat},${colTileLon[col]}`);
      if (!buffer) throw new Error(`missing SRTM tile for ${tileLat},${colTileLon[col]}`);
      const source = (rowInTile * SRTM_SPAN + colInTile[col]) * 2;
      let value = buffer.readInt16BE(source);
      if (value < -500) value = 0; // SRTM voids over water
      elevation[row * width + col] = value;
    }
  }
  log('AOI grid', `${width}x${height}`, 'at ~30 m');
  return { elevation, width, height };
}

// --- Hydrology: priority-flood, D8 tree, flow accumulation, HAND -----------

class MinHeap {
  #keys = [];
  #values = [];

  get size() {
    return this.#keys.length;
  }

  push(key, value) {
    this.#keys.push(key);
    this.#values.push(value);
    let index = this.#keys.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.#keys[parent] <= this.#keys[index]) break;
      this.#swap(parent, index);
      index = parent;
    }
  }

  pop() {
    const value = this.#values[0];
    const key = this.#keys.pop();
    const last = this.#values.pop();
    if (this.#keys.length > 0) {
      this.#keys[0] = key;
      this.#values[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (
          left < this.#keys.length &&
          this.#keys[left] < this.#keys[smallest]
        ) {
          smallest = left;
        }
        if (
          right < this.#keys.length &&
          this.#keys[right] < this.#keys[smallest]
        ) {
          smallest = right;
        }
        if (smallest === index) break;
        this.#swap(smallest, index);
        index = smallest;
      }
    }
    return value;
  }

  #swap(a, b) {
    [this.#keys[a], this.#keys[b]] = [this.#keys[b], this.#keys[a]];
    [this.#values[a], this.#values[b]] = [this.#values[b], this.#values[a]];
  }
}

/**
 * Priority-flood: pops cells lowest-first from the ocean and the tile border
 * inward, so every cell is discovered by a downhill-or-flat neighbour. The
 * discovery parent doubles as a D8 flow direction that is guaranteed to be
 * cycle-free and to route across sinks and flats.
 */
function drainageTree({ elevation, width, height }) {
  const total = width * height;
  const flowTo = new Int32Array(total).fill(-1);
  const order = new Int32Array(total);
  const visited = new Uint8Array(total);
  const filled = new Int16Array(elevation);
  const heap = new MinHeap();

  const seed = (index) => {
    if (visited[index]) return;
    visited[index] = 1;
    heap.push(filled[index], index);
  };

  for (let col = 0; col < width; col += 1) {
    seed(col);
    seed((height - 1) * width + col);
  }
  for (let row = 0; row < height; row += 1) {
    seed(row * width);
    seed(row * width + width - 1);
  }
  for (let index = 0; index < total; index += 1) {
    if (elevation[index] <= 0) seed(index); // the sea is the ultimate outlet
  }

  let count = 0;
  while (heap.size > 0) {
    const index = heap.pop();
    order[count] = index;
    count += 1;
    const row = (index / width) | 0;
    const col = index % width;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nc < 0 || nr >= height || nc >= width) continue;
        const neighbour = nr * width + nc;
        if (visited[neighbour]) continue;
        visited[neighbour] = 1;
        if (filled[neighbour] < filled[index])
          filled[neighbour] = filled[index];
        flowTo[neighbour] = index;
        heap.push(filled[neighbour], neighbour);
      }
    }
  }

  log('drainage tree built over', count, 'cells');
  return { flowTo, order, count };
}

function handRaster({ elevation, width, height }, { flowTo, order, count }) {
  const total = width * height;
  const accumulation = new Float64Array(total).fill(1);

  // Reverse discovery order runs leaves before their parents.
  for (let i = count - 1; i >= 0; i -= 1) {
    const index = order[i];
    const target = flowTo[index];
    if (target >= 0) accumulation[target] += accumulation[index];
  }

  const isDrainage = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (elevation[index] <= 0 || accumulation[index] >= DRAINAGE_CELLS) {
      isDrainage[index] = 1;
    }
  }

  // Walk downstream to the first drainage cell; memoised in discovery order so
  // each cell's parent is already resolved by the time we reach it.
  const bed = new Int16Array(total);
  for (let i = 0; i < count; i += 1) {
    const index = order[i];
    if (isDrainage[index]) {
      bed[index] = elevation[index];
      continue;
    }
    const target = flowTo[index];
    bed[index] = target >= 0 ? bed[target] : elevation[index];
  }

  const hand = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (elevation[index] <= 0) {
      hand[index] = 255; // sea: excluded from the flood layer
      continue;
    }
    const metres = Math.max(0, elevation[index] - bed[index]);
    hand[index] = Math.min(HAND_CAP_DM, Math.round(metres * 10));
  }

  return { hand, accumulation, isDrainage };
}

// --- Imagery ---------------------------------------------------------------

const mercX = (lon) => lon / 360 + 0.5;
const mercY = (lat) => {
  const phi = (lat * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / (2 * Math.PI);
};

async function bakeImagery() {
  const scale = 2 ** IMAGERY_ZOOM;
  const x0 = Math.floor(mercX(AOI.west) * scale);
  const x1 = Math.floor(mercX(AOI.east) * scale);
  const y0 = Math.floor(mercY(AOI.north) * scale);
  const y1 = Math.floor(mercY(AOI.south) * scale);
  const cols = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  log('imagery mosaic', `${cols}x${rows}`, 'tiles at z' + IMAGERY_ZOOM);

  const jobs = [];
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      jobs.push({ tx, ty });
    }
  }

  const composites = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      const file = path.join(
        CACHE,
        'tiles',
        `${IMAGERY_ZOOM}_${job.tx}_${job.ty}.jpg`,
      );
      const url = `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${IMAGERY_ZOOM}/${job.ty}/${job.tx}.jpg`;
      await download(url, file, {
        headers: {
          'User-Agent': 'resilinet-3d-ui-concept/0.1 (build-time bake)',
        },
      });
      composites.push({
        input: file,
        left: (job.tx - x0) * 256,
        top: (job.ty - y0) * 256,
      });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  const mosaic = await sharp({
    create: {
      width: cols * 256,
      height: rows * 256,
      channels: 3,
      background: '#0b2233',
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  // Crop the mosaic down to exactly the AOI's mercator box so the runtime can
  // map lon/lat to UV without knowing anything about tiles.
  const pixels = 256 * scale;
  const left = Math.round(mercX(AOI.west) * pixels - x0 * 256);
  const top = Math.round(mercY(AOI.north) * pixels - y0 * 256);
  const right = Math.round(mercX(AOI.east) * pixels - x0 * 256);
  const bottom = Math.round(mercY(AOI.south) * pixels - y0 * 256);

  await mkdir(OUT, { recursive: true });
  await sharp(mosaic)
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize(TEXTURE_SIZE, TEXTURE_SIZE, { fit: 'fill' })
    // Tropical canopy reads almost black straight off Sentinel-2; lift it so
    // the drape holds detail once the scene's own lighting is applied.
    .modulate({ brightness: 1.38, saturation: 1.3 })
    .linear(1.06, -6)
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(path.join(OUT, 'surface.jpg'));
  log('surface.jpg written at', TEXTURE_SIZE);
}

// --- OpenStreetMap context -------------------------------------------------

async function overpass(query, cacheKey) {
  const file = path.join(CACHE, `${cacheKey}.json`);
  if (!(await exists(file))) {
    log('querying Overpass for', cacheKey);
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'resilinet-3d-ui-concept/0.1 (build-time bake)',
      },
      body: new URLSearchParams({ data: query }),
    });
    if (!response.ok) throw new Error(`Overpass ${response.status}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, await response.text());
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

const BBOX = `${AOI.south},${AOI.west},${AOI.north},${AOI.east}`;

/** Fetches raw Overpass ways (with node ids and geometry) for a selector. */
async function fetchWays(selector, cacheKey) {
  const data = await overpass(
    `[out:json][timeout:120];way${selector}(${BBOX});out geom;`,
    cacheKey,
  );
  const ways = data.elements.filter(
    (way) => way.nodes && way.geometry && way.geometry.length >= 2,
  );
  log(cacheKey, ways.length, 'ways');
  return ways;
}

const fetchRoads = () =>
  fetchWays('["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]', 'roads');

// Unclassified roads are the rural connectors: without them the classified
// network splits into an east and a west half that only meet outside the
// AOI. Residential streets are fetched alongside but left out of the graph.
const fetchMinorRoads = async () =>
  (await fetchWays('["highway"~"^(unclassified|residential)$"]', 'roads-minor')).filter(
    (way) => way.tags.highway === 'unclassified',
  );

// The KTM East Coast line runs the length of the Galas valley; sidings and
// yards are left out so only the through line is drawn.
const fetchRails = () => fetchWays('["railway"="rail"]["service"!~"."]', 'rails');

const SIMPLIFY_DEG = 0.0005; // ~55 m between kept polyline points
const HAND_SAMPLE_METRES = 30;
const MAX_EDGE_KM = 1; // longer runs are split so one dip blocks one piece

/**
 * Builds a junction-preserving graph from OSM ways. Every node that appears
 * in more than one way, or ends a way, becomes a graph node; the geometry
 * between two graph nodes becomes one edge, simplified for drawing but with
 * HAND sampled along the full-resolution line so a dip under water is never
 * missed. Roads and rail share the graph; edges carry their class so the
 * router can keep trucks off the railway.
 */
function buildGraph(ways, { elevation, width, height }, hand) {
  const handAt = (lon, lat) => {
    const col = Math.floor(((lon - AOI.west) / (AOI.east - AOI.west)) * width);
    const row = Math.floor(((AOI.north - lat) / (AOI.north - AOI.south)) * height);
    if (col < 0 || row < 0 || col >= width || row >= height) return 255;
    const index = row * width + col;
    return elevation[index] <= 0 ? 255 : hand[index];
  };
  const metresBetween = (a, b) =>
    Math.hypot(
      (b.lon - a.lon) * metresPerDegLon((a.lat + b.lat) / 2),
      (b.lat - a.lat) * METRES_PER_DEG_LAT,
    );

  const uses = new Map();
  for (const way of ways) {
    for (const id of way.nodes) uses.set(id, (uses.get(id) ?? 0) + 1);
  }

  const nodes = [];
  const nodeIndex = new Map();
  const nodeFor = (id, point) => {
    let index = nodeIndex.get(id);
    if (index === undefined) {
      index = nodes.length;
      nodeIndex.set(id, index);
      nodes.push([Number(point.lon.toFixed(5)), Number(point.lat.toFixed(5))]);
    }
    return index;
  };

  const edges = [];
  for (const way of ways) {
    const klass = way.tags.railway === 'rail' ? 'rail' : way.tags.highway;
    const bridge = Boolean(way.tags.bridge && way.tags.bridge !== 'no');
    const last = way.nodes.length - 1;
    let start = 0;
    let sinceSplit = 0;
    for (let i = 1; i <= last; i += 1) {
      sinceSplit += metresBetween(way.geometry[i - 1], way.geometry[i]) / 1000;
      const isJunction = i === last || uses.get(way.nodes[i]) > 1;
      // Long runs between junctions are cut into ~1 km pieces so the route
      // wave and the blocked marks resolve where the water actually is.
      const isSplit = !isJunction && sinceSplit >= MAX_EDGE_KM;
      if (!isJunction && !isSplit) continue;
      sinceSplit = 0;
      const a = nodeFor(way.nodes[start], way.geometry[start]);
      const b = nodeFor(way.nodes[i], way.geometry[i]);

      // Drawn geometry: the run simplified to ~55 m, endpoints always kept.
      const points = [];
      let kept = null;
      for (let j = start; j <= i; j += 1) {
        const point = way.geometry[j];
        if (
          j === start ||
          j === i ||
          Math.hypot(point.lat - kept.lat, point.lon - kept.lon) >= SIMPLIFY_DEG
        ) {
          points.push([Number(point.lon.toFixed(5)), Number(point.lat.toFixed(5))]);
          kept = point;
        }
      }

      // HAND profile every ~30 m along the drawn polyline. offsets[k] is the
      // profile index of point k, so the samples of segment k are
      // profile[offsets[k] .. offsets[k + 1]]; the renderer and the router
      // read the same numbers.
      const profile = [handAt(points[0][0], points[0][1])];
      const offsets = [0];
      let km = 0;
      for (let k = 1; k < points.length; k += 1) {
        const [lon0, lat0] = points[k - 1];
        const [lon1, lat1] = points[k];
        const length = metresBetween({ lon: lon0, lat: lat0 }, { lon: lon1, lat: lat1 });
        km += length / 1000;
        const samples = Math.max(1, Math.ceil(length / HAND_SAMPLE_METRES));
        for (let s = 1; s <= samples; s += 1) {
          const u = s / samples;
          profile.push(handAt(lon0 + (lon1 - lon0) * u, lat0 + (lat1 - lat0) * u));
        }
        offsets.push(profile.length - 1);
      }

      if (a !== b && km > 0) {
        edges.push({
          a,
          b,
          klass,
          bridge,
          km: Number(km.toFixed(3)),
          handDm: Math.min(...profile),
          points,
          profile,
          offsets,
        });
      }
      start = i;
    }
  }

  const roadNodes = new Set();
  for (const edge of edges) {
    if (edge.klass !== 'rail') {
      roadNodes.add(edge.a);
      roadNodes.add(edge.b);
    }
  }
  const samples = edges.reduce((sum, edge) => sum + edge.profile.length, 0);
  log('graph', nodes.length, 'nodes,', edges.length, 'edges,', roadNodes.size, 'road nodes,', samples, 'HAND samples');
  return { nodes, edges, roadNodes };
}

/**
 * Where diesel comes from during an event: towns and OSM petrol stations,
 * each snapped to the nearest road node. A site can be refuelled while one
 * of these is within a crew's range by open road (lib/network.ts).
 */
async function bakeFuelSources(places, graph) {
  const data = await overpass(
    `[out:json][timeout:60];(node["amenity"="fuel"](${BBOX});way["amenity"="fuel"](${BBOX}););out center tags;`,
    'fuel',
  );
  const sources = [];
  for (const place of places) {
    if (place.place === 'town') sources.push({ kind: 'town', name: place.name, lon: place.lon, lat: place.lat });
  }
  for (const element of data.elements) {
    const lon = element.lon ?? element.center?.lon;
    const lat = element.lat ?? element.center?.lat;
    if (lon === undefined || lat === undefined) continue;
    sources.push({ kind: 'fuel', name: element.tags?.brand ?? element.tags?.name ?? 'Petrol station', lon, lat });
  }
  const snapped = sources.map((source) => {
    let best = null;
    for (const index of graph.roadNodes) {
      const [lon, lat] = graph.nodes[index];
      const distance = Math.hypot((lon - source.lon) * metresPerDegLon(source.lat), (lat - source.lat) * METRES_PER_DEG_LAT);
      if (!best || distance < best.distance) best = { distance, index };
    }
    return { ...source, lon: Number(source.lon.toFixed(5)), lat: Number(source.lat.toFixed(5)), node: best.index, snappedM: Math.round(best.distance) };
  });
  log('fuel sources', snapped.length, JSON.stringify(snapped.reduce((m, s) => ({ ...m, [s.kind]: (m[s.kind] ?? 0) + 1 }), {})));
  return snapped;
}

/** The place node the truck starts from, snapped onto the road graph. */
function pickDepot(places, graph) {
  const place =
    places.find((entry) => entry.name === 'Kuala Krai' && entry.place === 'town') ??
    places.find((entry) => entry.name === 'Kuala Krai');
  if (!place) throw new Error('no "Kuala Krai" place node in the AOI');
  let best = null;
  for (const index of graph.roadNodes) {
    const [lon, lat] = graph.nodes[index];
    const distance = Math.hypot(
      (lon - place.lon) * metresPerDegLon(place.lat),
      (lat - place.lat) * METRES_PER_DEG_LAT,
    );
    if (!best || distance < best.distance) best = { distance, index };
  }
  const [lon, lat] = graph.nodes[best.index];
  log('depot', place.name, 'snapped', Math.round(best.distance), 'm to node', best.index);
  return { lon, lat, node: best.index, name: place.name };
}

async function bakePlaces() {
  const data = await overpass(
    `[out:json][timeout:60];node["place"~"^(town|village|hamlet|suburb)$"]["name"](${BBOX});out body;`,
    'places',
  );
  return data.elements
    .filter((node) => node.tags?.name)
    .map((node) => ({
      name: node.tags.name,
      lon: Number(node.lon.toFixed(5)),
      lat: Number(node.lat.toFixed(5)),
      place: node.tags.place,
    }));
}

// --- Homes ------------------------------------------------------------------

/** Small deterministic PRNG so the illustrative houses never move between bakes. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

const METRES_PER_DEG_LAT = 110_574;
const metresPerDegLon = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);

function ringAreaM2(ring) {
  const lat0 = ring[0][1];
  const kx = metresPerDegLon(lat0);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += ring[j][0] * kx * ring[i][1] * METRES_PER_DEG_LAT;
    sum -= ring[i][0] * kx * ring[j][1] * METRES_PER_DEG_LAT;
  }
  return Math.abs(sum) / 2;
}

// Illustrative homes per settlement node that has no mapped residential area.
const CLUSTER_HOMES = { town: 260, suburb: 120, village: 70, hamlet: 25 };
const CLUSTER_SIGMA_M = { town: 520, suburb: 350, village: 260, hamlet: 170 };
const HOME_AREA_M2 = 1500; // one illustrative house per 0.15 ha of residential land

/**
 * Builds the homes list from OSM: real building centroids, houses scattered
 * through mapped residential areas, and clusters around settlement nodes the
 * residential layer misses. Houses never land in a channel cell.
 */
async function bakeHouses({ elevation, width, height }, hand, places) {
  const data = await overpass(
    `[out:json][timeout:180];(way["landuse"="residential"](${BBOX});way["building"](${BBOX}););out geom;`,
    'settlements',
  );
  const random = mulberry32(20141224);
  const homes = [];
  const cellOf = (lon, lat) => {
    const col = Math.floor(((lon - AOI.west) / (AOI.east - AOI.west)) * width);
    const row = Math.floor(((AOI.north - lat) / (AOI.north - AOI.south)) * height);
    if (col < 0 || row < 0 || col >= width || row >= height) return -1;
    return row * width + col;
  };
  // Dry land that is not the channel itself; kampungs do sit on floodplains.
  const habitable = (lon, lat) => {
    const index = cellOf(lon, lat);
    return index >= 0 && elevation[index] > 0 && hand[index] >= 3;
  };

  const residential = [];
  let buildings = 0;
  for (const way of data.elements) {
    if (!way.geometry || way.geometry.length < 3) continue;
    const ring = way.geometry.map((node) => [node.lon, node.lat]);
    if (way.tags.building) {
      let lon = 0;
      let lat = 0;
      for (const [x, y] of ring) {
        lon += x;
        lat += y;
      }
      lon /= ring.length;
      lat /= ring.length;
      const heading = Math.atan2(
        (ring[1][1] - ring[0][1]) * METRES_PER_DEG_LAT,
        (ring[1][0] - ring[0][0]) * metresPerDegLon(lat),
      );
      if (habitable(lon, lat)) {
        homes.push(lon, lat, heading);
        buildings += 1;
      }
    } else if (way.tags.landuse === 'residential') {
      residential.push(ring);
    }
  }

  let areaHomes = 0;
  for (const ring of residential) {
    const count = Math.min(600, Math.max(4, Math.round(ringAreaM2(ring) / HOME_AREA_M2)));
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const [lon, lat] of ring) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    let placed = 0;
    for (let attempt = 0; attempt < count * 20 && placed < count; attempt += 1) {
      const lon = west + random() * (east - west);
      const lat = south + random() * (north - south);
      if (!pointInRing(lon, lat, ring) || !habitable(lon, lat)) continue;
      homes.push(lon, lat, random() * Math.PI);
      placed += 1;
    }
    areaHomes += placed;
  }

  // Settlement nodes without a residential polygon within 600 m get a cluster.
  let clusterHomes = 0;
  const covered = (place) =>
    residential.some((ring) => {
      if (pointInRing(place.lon, place.lat, ring)) return true;
      return ring.some(
        ([lon, lat]) =>
          Math.hypot(
            (lon - place.lon) * metresPerDegLon(place.lat),
            (lat - place.lat) * METRES_PER_DEG_LAT,
          ) < 600,
      );
    });
  for (const place of places) {
    if (!(place.place in CLUSTER_HOMES) || covered(place)) continue;
    const count = CLUSTER_HOMES[place.place];
    const sigma = CLUSTER_SIGMA_M[place.place];
    let placed = 0;
    for (let attempt = 0; attempt < count * 20 && placed < count; attempt += 1) {
      // Box–Muller normal offsets in metres.
      const u = Math.max(random(), 1e-9);
      const v = random();
      const r = Math.sqrt(-2 * Math.log(u)) * sigma;
      const dx = r * Math.cos(2 * Math.PI * v);
      const dy = r * Math.sin(2 * Math.PI * v);
      const lon = place.lon + dx / metresPerDegLon(place.lat);
      const lat = place.lat + dy / METRES_PER_DEG_LAT;
      if (!habitable(lon, lat)) continue;
      homes.push(lon, lat, random() * Math.PI);
      placed += 1;
    }
    clusterHomes += placed;
  }

  log('homes', homes.length / 3, `(${buildings} buildings, ${areaHomes} in residential areas, ${clusterHomes} clustered)`);
  return {
    data: new Float32Array(homes),
    sources: { buildings, residentialAreas: residential.length, areaHomes, clusterHomes },
  };
}

const CANDIDATE_COUNT = 30;
const CANDIDATE_MIN_ABOVE_DATUM = 40; // metres
const CANDIDATE_MAX_ABOVE_DATUM = 350; // metres
const CANDIDATE_MIN_HAND_DM = 30; // dry at every modelled level
const CANDIDATE_SETTLEMENT_METRES = 4000;
const CANDIDATE_SPACING_METRES = 1000;
const CANDIDATE_MAX_ROAD_METRES = 300; // the truck parks here; no hike to the site
// A cell-on-cell (~62 m) tower-on-a-truck needs near-level ground: the site
// and every 30 m neighbour must be under this slope. Removes hillsides that
// score well on line of sight but could never take a mast.
const CANDIDATE_MAX_SLOPE_DEG = 10;

/**
 * Picks the pool of portable-tower candidates: dry high ground close to a
 * settlement and to a road, spread at least a kilometre apart. Heights are
 * measured from the floodplain datum rather than sea level so the same rule
 * works for an inland valley; towns pull harder than villages, as before.
 * Greedy by score, so candidates[0] is the single best site. Deterministic.
 */
function pickCandidates({ elevation, width, height }, hand, places, graph) {
  // Floodplain datum: median height of ground within 2 m of a channel.
  const plain = [];
  for (let index = 0; index < elevation.length; index += 1) {
    if (hand[index] < 20) plain.push(elevation[index]);
  }
  plain.sort((a, b) => a - b);
  const datum = plain[Math.floor(plain.length / 2)] ?? 0;
  log('floodplain datum', datum, 'm');

  const cellMetres = 30.87;
  const anchors = places.map((place) => ({
    row: ((AOI.north - place.lat) / (AOI.north - AOI.south)) * height,
    col: ((place.lon - AOI.west) / (AOI.east - AOI.west)) * width,
    scale: place.place === 'town' ? 1 / 3 : 1,
  }));
  const radiusCells = CANDIDATE_SETTLEMENT_METRES / cellMetres;

  // Slope from the steepest of the eight neighbours; a cell counts as
  // buildable only if it and its ring of neighbours are all gentle.
  const maxRise = Math.tan((CANDIDATE_MAX_SLOPE_DEG * Math.PI) / 180) * cellMetres;
  const gentle = (row, col) => {
    if (row < 1 || col < 1 || row >= height - 1 || col >= width - 1) return false;
    const centre = elevation[row * width + col];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const rise = Math.abs(elevation[(row + dr) * width + col + dc] - centre);
        if (rise > maxRise * Math.hypot(dr, dc)) return false;
      }
    }
    return true;
  };
  const buildable = (row, col) => {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (!gentle(row + dr, col + dc)) return false;
      }
    }
    return true;
  };

  // Every eligible cell with its score; the greedy pass below spreads them.
  const eligible = [];
  let steepRejected = 0;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const value = elevation[index];
      if (
        value < datum + CANDIDATE_MIN_ABOVE_DATUM ||
        value > datum + CANDIDATE_MAX_ABOVE_DATUM
      ) {
        continue;
      }
      if (hand[index] < CANDIDATE_MIN_HAND_DM) continue;
      if (!buildable(row, col)) {
        steepRejected += 1;
        continue;
      }
      let distance = Infinity;
      for (const anchor of anchors) {
        const raw = Math.hypot(row - anchor.row, col - anchor.col);
        if (raw > radiusCells) continue;
        distance = Math.min(distance, raw * anchor.scale);
      }
      if (distance === Infinity) continue;
      eligible.push({ score: value - datum - distance * 0.35, row, col, index });
    }
  }
  eligible.sort((a, b) => b.score - a.score);
  log('candidate cells', eligible.length, '· rejected as too steep', steepRejected);

  // Nearest road: closest vertex of any non-rail edge; the candidate's route
  // ends at that edge's nearer endpoint.
  const roadVertices = [];
  for (const edge of graph.edges) {
    if (edge.klass === 'rail') continue;
    const [aLon, aLat] = graph.nodes[edge.a];
    for (const [lon, lat] of edge.points) {
      const [bLon, bLat] = graph.nodes[edge.b];
      const toA = Math.hypot(lon - aLon, lat - aLat);
      const toB = Math.hypot(lon - bLon, lat - bLat);
      roadVertices.push({ lon, lat, node: toA <= toB ? edge.a : edge.b });
    }
  }
  const nearestRoad = (lon, lat) => {
    const kx = metresPerDegLon(lat);
    let best = null;
    for (const vertex of roadVertices) {
      const distance = Math.hypot(
        (vertex.lon - lon) * kx,
        (vertex.lat - lat) * METRES_PER_DEG_LAT,
      );
      if (!best || distance < best.distance) best = { distance, node: vertex.node };
    }
    return best;
  };

  const spacingCells = CANDIDATE_SPACING_METRES / cellMetres;
  const chosen = [];
  for (const cell of eligible) {
    if (chosen.length >= CANDIDATE_COUNT) break;
    const crowded = chosen.some(
      (other) => Math.hypot(other.row - cell.row, other.col - cell.col) < spacingCells,
    );
    if (crowded) continue;
    const lon = AOI.west + (cell.col / width) * (AOI.east - AOI.west);
    const lat = AOI.north - (cell.row / height) * (AOI.north - AOI.south);
    const road = nearestRoad(lon, lat);
    if (!road || road.distance > CANDIDATE_MAX_ROAD_METRES) continue;
    let nearest = null;
    for (const place of places) {
      const distance = Math.hypot(place.lon - lon, place.lat - lat);
      if (!nearest || distance < nearest.distance) nearest = { distance, place };
    }
    chosen.push({
      row: cell.row,
      col: cell.col,
      lon: Number(lon.toFixed(5)),
      lat: Number(lat.toFixed(5)),
      elevation: elevation[cell.index],
      handDm: hand[cell.index],
      name: nearest?.place.name ?? 'Candidate site',
      roadNode: road.node,
      nearestRoadM: Math.round(road.distance),
    });
  }
  if (chosen.length === 0) throw new Error('no tower candidate found');
  log('candidates', chosen.length, '· best', chosen[0].name, chosen[0].elevation + ' m');
  return chosen.map(({ row: _row, col: _col, ...candidate }) => candidate);
}

// --- Existing network sites --------------------------------------------------

// Hand-placed placeholder sites, used only to fill gaps where OSM and
// OpenCellID have nothing: one per major settlement, on high ground beside a
// road. Flagged source: 'seed' so the UI and README can say so.
// Positions were picked from the DEM: the highest dry (HAND ≥ 3 m) cell within
// 300 m of a road near each settlement, so a seed never sits in the river.
const SITE_SEEDS = [
  { name: 'Kuala Krai town', lon: 102.1965, lat: 5.5359 },
  { name: 'Kuala Krai bypass', lon: 102.1798, lat: 5.5261 },
  { name: 'Manek Urai', lon: 102.2296, lat: 5.3884 },
  { name: 'Kuala Gris', lon: 102.0528, lat: 5.3638 },
  { name: 'Dabong', lon: 101.982, lat: 5.3793 },
  { name: 'Kemubu', lon: 102.054, lat: 5.3523 },
  { name: 'Kuala Balah', lon: 102.0294, lat: 5.4467 },
  { name: 'Jelawang', lon: 101.948, lat: 5.3889 },
];
const SITE_MIN_COUNT = 8;
const SITE_MERGE_METRES = 300; // OSM/OpenCellID dedupe
// OpenCellID positions are where phones heard a cell, each with a single
// sample, so one macro site spreads into a cloud of points. Cells within
// SITE_CELL_CLUSTER_METRES are one site; a cluster counts only when at least
// SITE_MIN_CELLS cells or SITE_MIN_OPERATORS networks corroborate it.
const SITE_CELL_CLUSTER_METRES = 1200;
const SITE_MIN_CELLS = 3;
const SITE_MIN_OPERATORS = 2;
const SITE_MAX_COUNT = 12; // strongest clusters keep a marker; the rest are noise for this scale
const SITE_SPACING_METRES = 2500; // one marker per macro-site spacing; picks the strongest cluster in each area
// A crowd-sourced position is where phones heard the cell, often in the river
// or on the road; a real macro site stands on dry high ground nearby. Snap
// each site to the highest cell with HAND ≥ 3 m within this radius.
const SITE_SNAP_METRES = 500;
const OPERATORS = { 11: 'TM', 12: 'Maxis', 13: 'Celcom', 16: 'DiGi', 18: 'U Mobile', 19: 'Celcom', 152: 'Yes', 153: 'Webe', 158: 'Celcom' };
const SITE_TOWN_METRES = 2500; // a site this close to Kuala Krai town gets a genset
const SITE_DEFAULT_MAST_METRES = 45;
const SITE_BATTERY_HOURS = 8; // illustrative (rural macro sites carry 4–8 h); an operator's NOC knows the real runway
const SITE_FIBRE_METRES = 1000; // sites this close to the trunk road are fibre-fed
const SITE_MICROWAVE_METRES = 15000;

/** OSM masts and communication towers in the AOI (nodes and way centroids). */
async function fetchOsmTowers() {
  const data = await overpass(
    `[out:json][timeout:120];(node["man_made"~"^(mast|communications_tower)$"](${BBOX});way["man_made"~"^(mast|communications_tower)$"](${BBOX});node["man_made"="tower"]["tower:type"="communication"](${BBOX});way["man_made"="tower"]["tower:type"="communication"](${BBOX}););out center tags;`,
    'towers',
  );
  const towers = [];
  for (const element of data.elements) {
    const lon = element.lon ?? element.center?.lon;
    const lat = element.lat ?? element.center?.lat;
    if (lon === undefined || lat === undefined) continue;
    const tags = element.tags ?? {};
    // Masts tagged for other uses (lighting, flood-light, observation) are not sites.
    if (tags['tower:type'] && !/communication|mobile|telecom/i.test(tags['tower:type'])) continue;
    const height = Number.parseFloat(tags['tower:height'] ?? tags.height ?? '');
    towers.push({
      source: 'osm',
      name: tags.name ?? tags.operator ?? null,
      operator: tags.operator ?? null,
      lon,
      lat,
      mastMetres: Number.isFinite(height) ? height : null,
    });
  }
  log('osm towers', towers.length);
  return towers;
}

/**
 * OpenCellID cells for the AOI, clustered into sites. Skipped without a key:
 * get one free at https://opencellid.org (account → API keys) and export
 * OPENCELLID_KEY before baking. The area endpoint caps a query at 4 km², so
 * the AOI is walked in ~2 km tiles, each cached under .cache/opencellid/.
 * Positions are crowd-sourced estimates (often a single sample), so cells
 * within SITE_MERGE_METRES are one site.
 */
const OPENCELLID_TILE_DEG = 0.018; // ~2 km, under the 4 km² cap
async function fetchOpenCellIdSites() {
  const key = process.env.OPENCELLID_KEY;
  if (!key) return [];
  const dir = path.join(CACHE, 'opencellid');
  await mkdir(dir, { recursive: true });
  const cells = [];
  let tiles = 0;
  let fetched = 0;
  for (let lat = AOI.south; lat < AOI.north; lat += OPENCELLID_TILE_DEG) {
    for (let lon = AOI.west; lon < AOI.east; lon += OPENCELLID_TILE_DEG) {
      tiles += 1;
      const bbox = [lat, lon, Math.min(lat + OPENCELLID_TILE_DEG, AOI.north), Math.min(lon + OPENCELLID_TILE_DEG, AOI.east)]
        .map((v) => v.toFixed(4))
        .join(',');
      const file = path.join(dir, `${bbox}.json`);
      if (!(await exists(file))) {
        const response = await fetch(
          `https://opencellid.org/cell/getInArea?key=${key}&BBOX=${bbox}&format=json&limit=500`,
        );
        const text = await response.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        if (!response.ok || !parsed || parsed.error) {
          log('OpenCellID', response.status, parsed?.error ?? text.slice(0, 80), '— stopping; seeds fill the rest');
          break;
        }
        await writeFile(file, text);
        fetched += 1;
      }
      const data = JSON.parse(await readFile(file, 'utf8'));
      for (const cell of data.cells ?? []) {
        cells.push({ lon: Number(cell.lon), lat: Number(cell.lat), radio: cell.radio, mnc: cell.mnc });
      }
    }
  }
  const clusters = [];
  for (const cell of cells) {
    const kx = metresPerDegLon(cell.lat);
    const near = clusters.find(
      (c) => Math.hypot((c.lon - cell.lon) * kx, (c.lat - cell.lat) * METRES_PER_DEG_LAT) < SITE_CELL_CLUSTER_METRES,
    );
    if (near) {
      near.lon = (near.lon * near.n + cell.lon) / (near.n + 1);
      near.lat = (near.lat * near.n + cell.lat) / (near.n + 1);
      near.n += 1;
      near.operators.add(cell.mnc);
    } else {
      clusters.push({ lon: cell.lon, lat: cell.lat, n: 1, operators: new Set([cell.mnc]) });
    }
  }
  const credible = clusters
    .filter((c) => c.n >= SITE_MIN_CELLS || c.operators.size >= SITE_MIN_OPERATORS)
    .sort((a, b) => b.n - a.n);
  // Greedy by strength with a spacing rule, so the marker set spreads along
  // the valley instead of stacking up where the trunk road carries traffic.
  const picked = [];
  for (const c of credible) {
    if (picked.length >= SITE_MAX_COUNT) break;
    const kx = metresPerDegLon(c.lat);
    if (picked.some((p) => Math.hypot((p.lon - c.lon) * kx, (p.lat - c.lat) * METRES_PER_DEG_LAT) < SITE_SPACING_METRES)) continue;
    picked.push(c);
  }
  log('opencellid', tiles, 'tiles (' + fetched + ' fetched),', cells.length, 'cells →', clusters.length, 'clusters →', credible.length, 'credible →', picked.length, 'sites');
  return picked.map((c) => ({
    source: 'opencellid',
    name: null,
    operator: [...new Set([...c.operators].map((mnc) => OPERATORS[mnc] ?? `MNC ${mnc}`))].join(' / '),
    lon: c.lon,
    lat: c.lat,
    mastMetres: null,
    cells: c.n,
  }));
}

/**
 * Merges the tower sources, tops up with seeds where the map is empty, and
 * attaches the fields the failure model needs: ground, HAND, access node,
 * power, and a backhaul parent. Backhaul rule (an assumption, documented in
 * the README): sites within SITE_FIBRE_METRES of the trunk road are fibre-fed
 * and chain toward Kuala Krai along the road; every other site is a microwave
 * link to the nearest site that can see it; the Kuala Krai town site is the hub.
 */
function buildSites(raw, grid, hand, places, graph, depot) {
  const { elevation, width, height } = grid;
  const metresBetween = (a, b) =>
    Math.hypot((a.lon - b.lon) * metresPerDegLon((a.lat + b.lat) / 2), (a.lat - b.lat) * METRES_PER_DEG_LAT);
  const cellOf = (lon, lat) => {
    const col = Math.floor(((lon - AOI.west) / (AOI.east - AOI.west)) * width);
    const row = Math.floor(((AOI.north - lat) / (AOI.north - AOI.south)) * height);
    if (col < 0 || row < 0 || col >= width || row >= height) return -1;
    return row * width + col;
  };

  // Dedupe: an OSM tower within a cell cluster's radius is that cluster's
  // real position, so it wins the location and keeps the cluster's cells.
  const merged = [];
  for (const site of raw) {
    if (cellOf(site.lon, site.lat) < 0) continue;
    const radius = site.source === 'osm' || merged.some((o) => o.source === 'osm') ? SITE_CELL_CLUSTER_METRES : SITE_MERGE_METRES;
    const twin = merged.find((other) => metresBetween(other, site) < radius);
    if (twin) {
      if (site.source === 'osm' && twin.source !== 'osm') {
        Object.assign(twin, { lon: site.lon, lat: site.lat, source: 'osm', mastMetres: site.mastMetres ?? twin.mastMetres, name: site.name ?? twin.name });
      } else if (twin.source === 'osm' && site.source === 'opencellid') {
        twin.cells = (twin.cells ?? 0) + (site.cells ?? 0);
        twin.operator = twin.operator ?? site.operator;
      }
      continue;
    }
    merged.push({ ...site });
  }

  // Snap each site to the highest dry cell within SITE_SNAP_METRES.
  for (const site of merged) {
    const kx = metresPerDegLon(site.lat);
    const dlon = SITE_SNAP_METRES / kx;
    const dlat = SITE_SNAP_METRES / METRES_PER_DEG_LAT;
    let best = null;
    for (let lat = site.lat - dlat; lat <= site.lat + dlat; lat += 0.0003) {
      for (let lon = site.lon - dlon; lon <= site.lon + dlon; lon += 0.0003) {
        const index = cellOf(lon, lat);
        if (index < 0 || hand[index] < 30) continue;
        if (Math.hypot((lon - site.lon) * kx, (lat - site.lat) * METRES_PER_DEG_LAT) > SITE_SNAP_METRES) continue;
        if (!best || elevation[index] > best.elevation) best = { lon, lat, elevation: elevation[index] };
      }
    }
    if (best) {
      site.snappedM = Math.round(metresBetween(site, best));
      site.lon = best.lon;
      site.lat = best.lat;
    }
  }
  if (merged.length < SITE_MIN_COUNT) {
    for (const seed of SITE_SEEDS) {
      if (merged.length >= Math.max(SITE_MIN_COUNT, 12)) break;
      if (merged.some((other) => metresBetween(other, seed) < SITE_MERGE_METRES)) continue;
      merged.push({ source: 'seed', name: seed.name, operator: null, lon: seed.lon, lat: seed.lat, mastMetres: null });
    }
  }

  const town = places.find((p) => p.name === 'Kuala Krai' && p.place === 'town') ?? depot;
  const nearestPlace = (site) => {
    let best = null;
    for (const place of places) {
      const d = metresBetween(place, site);
      if (!best || d < best.d) best = { d, place };
    }
    return best?.place.name ?? 'Site';
  };
  const nearestRoadNode = (site) => {
    let best = null;
    for (const index of graph.roadNodes) {
      const [lon, lat] = graph.nodes[index];
      const d = metresBetween({ lon, lat }, site);
      if (!best || d < best.d) best = { d, index };
    }
    return best;
  };
  const trunkVertices = [];
  for (const edge of graph.edges) {
    if (edge.klass !== 'trunk' && edge.klass !== 'primary') continue;
    for (const [lon, lat] of edge.points) trunkVertices.push({ lon, lat });
  }
  const trunkDistance = (site) => Math.min(...trunkVertices.map((v) => metresBetween(v, site)));

  // Repeated place names get a compass suffix so every site reads uniquely.
  const baseNames = merged.map((site) => site.name ?? nearestPlace(site));
  const placeOf = (site) => places.find((p) => p.name === nearestPlace(site)) ?? site;
  const compass = (site) => {
    const p = placeOf(site);
    const dx = (site.lon - p.lon) * metresPerDegLon(p.lat);
    const dy = (site.lat - p.lat) * METRES_PER_DEG_LAT;
    if (Math.hypot(dx, dy) < 400) return 'centre';
    const angle = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(angle / 45) % 8];
  };
  const sites = merged.map((site, index) => {
    const cell = cellOf(site.lon, site.lat);
    const road = nearestRoadNode(site);
    const toTown = metresBetween(site, town);
    const repeated = baseNames.filter((n) => n === baseNames[index]).length > 1;
    return {
      id: `site-${index}`,
      name: site.name && site.source === 'osm' ? site.name : repeated ? `${baseNames[index]} ${compass(site)}` : baseNames[index],
      operator: site.operator,
      lon: Number(site.lon.toFixed(5)),
      lat: Number(site.lat.toFixed(5)),
      elevation: elevation[cell],
      handDm: hand[cell],
      mastMetres: site.mastMetres ?? SITE_DEFAULT_MAST_METRES,
      source: site.source,
      cells: site.cells ?? 0,
      snappedM: site.snappedM ?? 0,
      power: { grid: true, batteryHours: SITE_BATTERY_HOURS, genset: toTown < SITE_TOWN_METRES },
      accessNode: road.index,
      accessRoadM: Math.round(road.d),
      toTownM: Math.round(toTown),
      trunkM: Math.round(trunkDistance(site)),
      backhaul: { parent: null, kind: 'microwave' },
    };
  });
  // A compass suffix can still collide (two sites south-east of one village);
  // number those so every name stays unique.
  const seen = new Map();
  for (const site of sites) seen.set(site.name, (seen.get(site.name) ?? 0) + 1);
  const counter = new Map();
  for (const site of sites) {
    if ((seen.get(site.name) ?? 0) < 2) continue;
    const n = (counter.get(site.name) ?? 0) + 1;
    counter.set(site.name, n);
    site.name = `${site.name} ${n}`;
  }
  if (sites.length === 0) throw new Error('no network sites');

  // Hub: the site nearest Kuala Krai town.
  const hub = sites.reduce((a, b) => (b.toTownM < a.toTownM ? b : a));
  hub.backhaul = { parent: null, kind: 'fibre' };

  // Fibre sites chain toward the hub along the road: parent = the next fibre
  // site that is closer to town (by road distance proxy: straight line).
  const fibre = sites.filter((s) => s !== hub && s.trunkM <= SITE_FIBRE_METRES);
  for (const site of fibre) {
    const closer = [hub, ...fibre].filter((o) => o !== site && o.toTownM < site.toTownM);
    const parent = closer.reduce((a, b) => (metresBetween(b, site) < metresBetween(a, site) ? b : a), hub);
    site.backhaul = { parent: parent.id, kind: 'fibre' };
  }

  // Microwave sites: nearest site with line of sight from mast to mast.
  const lineOfSight = (from, to) => {
    const eye = elevation[cellOf(from.lon, from.lat)] + from.mastMetres;
    const target = elevation[cellOf(to.lon, to.lat)] + to.mastMetres;
    const distance = metresBetween(from, to);
    const steps = Math.max(2, Math.ceil(distance / 30));
    for (let s = 1; s < steps; s += 1) {
      const t = s / steps;
      const lon = from.lon + (to.lon - from.lon) * t;
      const lat = from.lat + (to.lat - from.lat) * t;
      const ground = elevation[cellOf(lon, lat)];
      if (ground > eye + (target - eye) * t - 5) return false; // 5 m clearance
    }
    return true;
  };
  for (const site of sites) {
    if (site.backhaul.kind === 'fibre') continue;
    const others = sites
      .filter((o) => o !== site && metresBetween(o, site) <= SITE_MICROWAVE_METRES)
      .sort((a, b) => metresBetween(a, site) - metresBetween(b, site));
    const seen = others.find((o) => lineOfSight(site, o));
    const parent = seen ?? others[0] ?? hub;
    site.backhaul = { parent: parent.id, kind: 'microwave', lineOfSight: Boolean(seen) };
  }

  const bySource = sites.reduce((m, s) => ({ ...m, [s.source]: (m[s.source] ?? 0) + 1 }), {});
  log('sites', sites.length, JSON.stringify(bySource), '· hub', hub.name);
  return sites;
}

// --- Main ------------------------------------------------------------------

async function main() {
  const tiles = await loadSrtm();
  const grid = cropAoi(tiles);
  const tree = drainageTree(grid);
  const { hand } = handRaster(grid, tree);

  // Downsample the analysis grid to the render mesh.
  const width = Math.floor(grid.width / MESH_STEP);
  const height = Math.floor(grid.height / MESH_STEP);
  const meshElevation = new Int16Array(width * height);
  const meshHand = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const source = row * MESH_STEP * grid.width + col * MESH_STEP;
      meshElevation[row * width + col] = grid.elevation[source];
      meshHand[row * width + col] = hand[source];
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (const value of meshElevation) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(
    path.join(OUT, 'elevation.bin'),
    Buffer.from(meshElevation.buffer),
  );
  await writeFile(path.join(OUT, 'hand.bin'), Buffer.from(meshHand.buffer));

  const ways = [
    ...(await fetchRoads()),
    ...(await fetchMinorRoads()),
    ...(await fetchRails()),
  ];
  const graph = buildGraph(ways, grid, hand);
  await writeFile(
    path.join(OUT, 'roads.json'),
    JSON.stringify({ nodes: graph.nodes, edges: graph.edges }),
  );
  const places = await bakePlaces();
  const depot = pickDepot(places, graph);
  const fuelSources = await bakeFuelSources(places, graph);
  const candidates = pickCandidates(grid, hand, places, graph);
  const sites = buildSites(
    [...(await fetchOsmTowers()), ...(await fetchOpenCellIdSites())],
    grid,
    hand,
    places,
    graph,
    depot,
  );
  const towerSite = candidates[0];
  const houses = await bakeHouses(grid, hand, places);
  await writeFile(path.join(OUT, 'houses.bin'), Buffer.from(houses.data.buffer));
  await bakeImagery();

  const metadata = {
    aoi: AOI,
    grid: { width, height, spacingMetres: MESH_STEP * 30.87 },
    elevation: { min, max, unit: 'metre', format: 'int16le' },
    hand: { unit: 'decimetre', dryValue: 255, format: 'uint8' },
    texture: {
      file: 'surface.jpg',
      size: TEXTURE_SIZE,
      projection: 'epsg3857',
    },
    drainageCells: DRAINAGE_CELLS,
    roads: {
      file: 'roads.json',
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    },
    places,
    depot,
    fuelSources,
    candidates,
    sites,
    towerSite,
    houses: {
      file: 'houses.bin',
      count: houses.data.length / 3,
      format: 'float32le lon,lat,heading',
      sources: houses.sources,
    },
    attribution: [
      'Elevation: NASA SRTM 1 arc-second (AWS Open Data elevation-tiles-prod)',
      'Imagery: Sentinel-2 cloudless 2020 by EOX IT Services, CC BY 4.0 (ESA Copernicus)',
      'Roads, railway, settlements, residential areas and buildings: OpenStreetMap contributors, ODbL',
      'Network sites: OpenStreetMap masts and communication towers, ODbL; OpenCellID when a key is present, CC BY-SA 4.0; hand-placed seeds where the map is empty',
      'Fuel sources: OpenStreetMap amenity=fuel, ODbL',
    ],
  };
  await writeFile(path.join(OUT, 'terrain.json'), JSON.stringify(metadata));
  log('done', `${width}x${height} mesh`, `${min}..${max} m`);
}

await main();
