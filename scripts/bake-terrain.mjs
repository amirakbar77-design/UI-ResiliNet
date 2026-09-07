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
 *   - Roads and settlements: OpenStreetMap via Overpass, ODbL.
 *
 * Outputs into public/terrain/:
 *   elevation.bin  Int16 little-endian metres, row-major, north row first
 *   hand.bin       Uint8 decimetres of Height Above Nearest Drainage, 255 = dry
 *   surface.jpg    Sentinel-2 mosaic reprojected to the AOI's mercator box
 *   terrain.json   grid metadata, attribution, roads, settlements, tower site
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import sharp from 'sharp';

// Area of interest: Gunung Jerai, the Yan coastal plain, and the Straits.
const AOI = { west: 100.28, east: 100.52, south: 5.68, north: 5.92 };
const SRTM_TILE = 'N05E100';
const SRTM_SPAN = 3601; // 1 arc-second samples per degree tile, inclusive edge
const IMAGERY_ZOOM = 14;
const TEXTURE_SIZE = 2048;
const MESH_STEP = 2; // downsample factor from the 30 m analysis grid
const DRAINAGE_CELLS = 150; // upstream cells before a cell counts as drainage
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

async function loadSrtm() {
  const hgt = path.join(CACHE, `${SRTM_TILE}.hgt`);
  if (!(await exists(hgt))) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${SRTM_TILE.slice(0, 3)}/${SRTM_TILE}.hgt.gz`;
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
  log('SRTM tile loaded', buffer.length, 'bytes');
  return buffer;
}

/** Crop the AOI out of the 1°x1° tile at native 1 arc-second resolution. */
function cropAoi(buffer) {
  const lonOffset = Number(SRTM_TILE.slice(4)); // 100
  const latOffset = Number(SRTM_TILE.slice(1, 3)); // 05
  const col0 = Math.round((AOI.west - lonOffset) * 3600);
  const col1 = Math.round((AOI.east - lonOffset) * 3600);
  const row0 = Math.round((latOffset + 1 - AOI.north) * 3600);
  const row1 = Math.round((latOffset + 1 - AOI.south) * 3600);
  const width = col1 - col0;
  const height = row1 - row0;
  const elevation = new Int16Array(width * height);

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const source = ((row0 + row) * SRTM_SPAN + col0 + col) * 2;
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
    .modulate({ brightness: 1.22, saturation: 1.28 })
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

async function bakeRoads() {
  const data = await overpass(
    `[out:json][timeout:120];way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${BBOX});out geom;`,
    'roads',
  );
  const roads = [];
  for (const way of data.elements) {
    if (!way.geometry || way.geometry.length < 2) continue;
    const points = [];
    let last = null;
    for (const node of way.geometry) {
      // Decimate to ~60 m so the drape stays cheap.
      if (
        last &&
        Math.hypot(node.lat - last.lat, node.lon - last.lon) < 0.0005
      ) {
        continue;
      }
      points.push([Number(node.lon.toFixed(5)), Number(node.lat.toFixed(5))]);
      last = node;
    }
    if (points.length < 2) continue;
    roads.push({ klass: way.tags.highway, points });
  }
  log('roads', roads.length, 'ways');
  return roads;
}

async function bakePlaces() {
  const data = await overpass(
    `[out:json][timeout:60];node["place"~"^(town|village|suburb)$"]["name"](${BBOX});out body;`,
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

/**
 * Picks the portable-tower candidate: the highest ground that is still close
 * to the settled coastal plain, dry at any modelled flood level, and low
 * enough to be reachable. Deterministic, so the concept always opens on the
 * same site.
 */
function pickTowerSite({ elevation, width, height }, hand, places) {
  let sumRow = 0;
  let sumCol = 0;
  let count = 0;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const value = elevation[row * width + col];
      if (value > 2 && value < 20) {
        sumRow += row;
        sumCol += col;
        count += 1;
      }
    }
  }
  const plainRow = sumRow / count;
  const plainCol = sumCol / count;
  const radiusCells = 6000 / 30.87;

  let best = null;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const value = elevation[index];
      if (value < 40 || value > 200) continue;
      if (hand[index] < 30) continue;
      const distance = Math.hypot(row - plainRow, col - plainCol);
      if (distance > radiusCells) continue;
      const score = value - distance * 0.35;
      if (!best || score > best.score)
        best = { score, row, col, elevation: value };
    }
  }

  const lon = AOI.west + (best.col / width) * (AOI.east - AOI.west);
  const lat = AOI.north - (best.row / height) * (AOI.north - AOI.south);
  let nearest = null;
  for (const place of places) {
    const distance = Math.hypot(place.lon - lon, place.lat - lat);
    if (!nearest || distance < nearest.distance) nearest = { distance, place };
  }
  return {
    lon: Number(lon.toFixed(5)),
    lat: Number(lat.toFixed(5)),
    elevation: best.elevation,
    name: nearest?.place.name ?? 'Candidate site',
  };
}

// --- Main ------------------------------------------------------------------

async function main() {
  const buffer = await loadSrtm();
  const grid = cropAoi(buffer);
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

  const roads = await bakeRoads();
  const places = await bakePlaces();
  const towerSite = pickTowerSite(grid, hand, places);
  log('tower candidate', towerSite.name, towerSite.elevation + ' m');
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
    roads,
    places,
    towerSite,
    attribution: [
      'Elevation: NASA SRTM 1 arc-second (AWS Open Data elevation-tiles-prod)',
      'Imagery: Sentinel-2 cloudless 2020 by EOX IT Services, CC BY 4.0 (ESA Copernicus)',
      'Roads and settlements: OpenStreetMap contributors, ODbL',
    ],
  };
  await writeFile(path.join(OUT, 'terrain.json'), JSON.stringify(metadata));
  log('done', `${width}x${height} mesh`, `${min}..${max} m`);
}

await main();
