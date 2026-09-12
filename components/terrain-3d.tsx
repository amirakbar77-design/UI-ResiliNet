'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, RadioTower, TriangleAlert } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import {
  clamp,
  elevationToWorldY,
  floodLevelForHour,
  HAND_DRY,
  type LayerKey,
  lonLatToWorld,
  mercatorUv,
  metresPerDegreeLon,
  type Place,
  SCENE_SCALE,
  sceneGrid,
  type TerrainData,
  terrainResource,
} from '@/lib/terrain-field';

const COVERAGE_RADIUS_METRES = 9000;
const TOWER_MAST_METRES = 32;
const IDLE_DRIFT_DELAY = 4200;
const BASE_DAMPING = 0.07; // per 60 Hz frame; rescaled to the real frame time
const GESTURE_TAIL_MS = 250;
const WHEEL_ZOOM_RATE = 0.0008; // log-distance per wheel pixel (~8 % per 100 px)
const SWIPE_ORBIT_RATE = 0.0035; // radians of azimuth per horizontal wheel pixel
const SWIPE_FLY_RATE = 0.0025; // fraction of camera height per vertical wheel pixel
const GESTURE_EASE_SECONDS = 0.12;
const FRAME_SAMPLE = 40;
const MAX_PLACE_MARKERS = 4;
// Homes are drawn about three times their true footprint so a kampung still
// reads as a cluster from the valley-wide opening view.
const HOME_FOOTPRINT_METRES = 36;
const HOME_HEIGHT_METRES = 9;
const HOME_COUNT_RADIUS_METRES = 1200;

type Anchor = {
  id: string;
  kind: 'tower' | 'population';
  label: string;
  detail: string;
  lon: number;
  lat: number;
  liftMetres: number;
};

type StatusElements = {
  severed: HTMLElement | null;
  area: HTMLElement | null;
  homes: HTMLElement | null;
};

type SceneHandle = {
  setLayers: (layers: Record<LayerKey, boolean>) => void;
  setHour: (hour: number) => void;
  resetView: () => void;
  dispose: () => void;
};

/**
 * Picks the settlements with the most flood-exposed ground within about
 * 1.5 km, so the markers sit where the HAND raster says the risk is.
 */
function deriveAnchors(terrain: TerrainData): Anchor[] {
  const { meta, hand, houses, width, height } = terrain;
  const g = sceneGrid(meta);
  const radiusCells = Math.round(1500 / (g.lonStep * 111_320));
  const homesNear = (place: Place) => {
    const kx = metresPerDegreeLon(place.lat);
    let count = 0;
    for (let i = 0; i < houses.length; i += 3) {
      const dx = (houses[i]! - place.lon) * kx;
      const dy = (houses[i + 1]! - place.lat) * 110_574;
      if (dx * dx + dy * dy < HOME_COUNT_RADIUS_METRES ** 2) count += 1;
    }
    return count;
  };

  const scored = meta.places.map((place) => {
    const col = Math.round((place.lon - meta.aoi.west) / g.lonStep);
    const row = Math.round((meta.aoi.north - place.lat) / g.latStep);
    let exposed = 0;
    for (let r = row - radiusCells; r <= row + radiusCells; r += 1) {
      if (r < 0 || r >= height) continue;
      for (let c = col - radiusCells; c <= col + radiusCells; c += 1) {
        if (c < 0 || c >= width) continue;
        const value = hand[r * width + c]!;
        if (value !== HAND_DRY && value < 25) exposed += 1;
      }
    }
    return { place, exposed };
  });

  scored.sort((a, b) => b.exposed - a.exposed);

  const anchors: Anchor[] = [
    {
      id: 'tower-candidate',
      kind: 'tower',
      label: meta.towerSite.name,
      detail: `Elevation: ${meta.towerSite.elevation} m`,
      lon: meta.towerSite.lon,
      lat: meta.towerSite.lat,
      liftMetres: TOWER_MAST_METRES + 30,
    },
  ];

  const chosen: typeof scored = [];
  for (const candidate of scored) {
    if (chosen.length >= MAX_PLACE_MARKERS) break;
    const tooClose = chosen.some(
      (other) =>
        Math.hypot(
          other.place.lon - candidate.place.lon,
          other.place.lat - candidate.place.lat,
        ) < 0.022,
    );
    if (!tooClose) chosen.push(candidate);
  }

  chosen.forEach((entry, index) => {
    anchors.push({
      id: `place-${entry.place.name}-${index}`,
      kind: 'population',
      label: entry.place.name,
      detail: `${homesNear(entry.place)} homes`,
      lon: entry.place.lon,
      lat: entry.place.lat,
      liftMetres: 60,
    });
  });

  return anchors;
}

function createScene(
  container: HTMLDivElement,
  terrain: TerrainData,
  anchors: Anchor[],
  markerElements: Map<string, HTMLDivElement>,
  status: StatusElements,
  initialHour: number,
): SceneHandle {
  const { meta, elevation, hand, width, height } = terrain;
  const g = sceneGrid(meta);
  const vertexCount = width * height;

  const deviceRatio = globalThis.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({
    // MSAA buys little at Retina density and costs a lot on integrated GPUs.
    antialias: deviceRatio < 1.5,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(deviceRatio, 1.5));
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd3e2ee, 420, 1500);

  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 8;
  skyCanvas.height = 256;
  const skyContext = skyCanvas.getContext('2d');
  if (skyContext) {
    const gradient = skyContext.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#6ea8d8');
    gradient.addColorStop(0.5, '#b6d3e9');
    gradient.addColorStop(1, '#dfe9ef');
    skyContext.fillStyle = gradient;
    skyContext.fillRect(0, 0, 8, 256);
  }
  const sky = new THREE.CanvasTexture(skyCanvas);
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    1,
    3000,
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = BASE_DAMPING;
  // Map conventions: drag pans across the ground, right- or shift-drag orbits.
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.panSpeed = 0.8;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.minDistance = 45;
  controls.maxDistance = 700;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = 1.45; // low enough to fly along the valley floor
  controls.autoRotateSpeed = 0.22;

  // The Sentinel-2 drape already carries its own illumination, so the scene
  // lights mostly lift it and add just enough directional shaping for relief.
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  scene.add(new THREE.HemisphereLight(0xcfe4f3, 0x3b4433, 0.45));
  const sun = new THREE.DirectionalLight(0xfff4e4, 0.85);
  sun.position.set(-400, 520, 260);
  scene.add(sun);

  // --- Terrain surface ---------------------------------------------------
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const originX = ((width - 1) / 2) * g.xStep;
  const originZ = ((height - 1) / 2) * g.zStep;

  for (let row = 0; row < height; row += 1) {
    const lat = meta.aoi.north - row * g.latStep;
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const lon = meta.aoi.west + col * g.lonStep;
      positions[index * 3] = col * g.xStep - originX;
      positions[index * 3 + 1] = elevationToWorldY(elevation[index]!);
      positions[index * 3 + 2] = row * g.zStep - originZ;
      const { u, v } = mercatorUv(meta, lon, lat);
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
    }
  }

  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  let cursor = 0;
  for (let row = 0; row < height - 1; row += 1) {
    for (let col = 0; col < width - 1; col += 1) {
      const a = row * width + col;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3),
  );
  terrainGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  terrainGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  terrainGeometry.computeVertexNormals();

  const surfaceTexture = new THREE.Texture(terrain.surface);
  // ImageBitmap sources cannot be flipped at upload, so the UVs above already
  // run north to south.
  surfaceTexture.flipY = false;
  surfaceTexture.colorSpace = THREE.SRGBColorSpace;
  surfaceTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  surfaceTexture.wrapS = THREE.ClampToEdgeWrapping;
  surfaceTexture.wrapT = THREE.ClampToEdgeWrapping;
  surfaceTexture.needsUpdate = true;

  const terrainMesh = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshStandardMaterial({
      map: surfaceTexture,
      roughness: 1,
      metalness: 0,
    }),
  );
  scene.add(terrainMesh);

  const worldToCell = (x: number, z: number) => ({
    col: clamp((x + originX) / g.xStep, 0, width - 1.001),
    row: clamp((z + originZ) / g.zStep, 0, height - 1.001),
  });

  /** Bilinear elevation in metres for any world position. */
  const elevationAt = (x: number, z: number) => {
    const { col, row } = worldToCell(x, z);
    const c0 = Math.floor(col);
    const r0 = Math.floor(row);
    const tc = col - c0;
    const tr = row - r0;
    const e00 = elevation[r0 * width + c0]!;
    const e10 = elevation[r0 * width + c0 + 1]!;
    const e01 = elevation[(r0 + 1) * width + c0]!;
    const e11 = elevation[(r0 + 1) * width + c0 + 1]!;
    return (
      e00 * (1 - tc) * (1 - tr) +
      e10 * tc * (1 - tr) +
      e01 * (1 - tc) * tr +
      e11 * tc * tr
    );
  };

  const handAt = (lon: number, lat: number) => {
    const col = clamp(
      Math.round((lon - meta.aoi.west) / g.lonStep),
      0,
      width - 1,
    );
    const row = clamp(
      Math.round((meta.aoi.north - lat) / g.latStep),
      0,
      height - 1,
    );
    return hand[row * width + col]!;
  };

  const worldOf = (lon: number, lat: number, liftMetres = 0) => {
    const { x, z } = lonLatToWorld(meta, lon, lat);
    return new THREE.Vector3(
      x,
      elevationToWorldY(elevationAt(x, z) + liftMetres),
      z,
    );
  };

  // --- Flood surface from the baked HAND raster --------------------------
  const shallowTint = new THREE.Color('#8fd8f5');
  const deepTint = new THREE.Color('#0a4f92');
  const floodGeometry = new THREE.BufferGeometry();
  const floodMesh = new THREE.Mesh(
    floodGeometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      roughness: 0.15,
      metalness: 0.05,
    }),
  );
  floodMesh.renderOrder = 1;
  scene.add(floodMesh);

  const floodIndexMap = new Int32Array(vertexCount);
  const waterColor = new THREE.Color();

  const wetAt = (index: number, level: number) => {
    const value = hand[index]!;
    return value !== HAND_DRY && value / 10 < level;
  };

  const cellAreaKm2 = meta.grid.spacingMetres ** 2 / 1_000_000;
  let floodedKm2 = 0;

  const buildFlood = (hour: number) => {
    const level = floodLevelForHour(hour);
    floodIndexMap.fill(-1);
    let wetCells = 0;
    for (let index = 0; index < vertexCount; index += 1) {
      if (wetAt(index, level)) wetCells += 1;
    }
    const waterPositions: number[] = [];
    const waterColors: number[] = [];
    const waterIndices: number[] = [];

    const pushVertex = (index: number) => {
      const existing = floodIndexMap[index]!;
      if (existing >= 0) return existing;
      const value = hand[index]!;
      const ground = elevation[index]!;
      const dry = value === HAND_DRY;
      const handMetres = value / 10;
      const depth = dry ? 0 : level - handMetres;
      // The sheet sits on the drainage datum plus the flood level, so terrain
      // above it simply occludes the water instead of the water climbing.
      const surface = dry ? ground : ground - handMetres + level;
      waterPositions.push(
        positions[index * 3]!,
        elevationToWorldY(surface),
        positions[index * 3 + 2]!,
      );
      waterColor.copy(shallowTint).lerp(deepTint, clamp(depth / 8, 0, 1));
      waterColors.push(
        waterColor.r,
        waterColor.g,
        waterColor.b,
        depth > 0 ? clamp(0.55 + depth * 0.04, 0.55, 0.94) : 0,
      );
      const next = waterPositions.length / 3 - 1;
      floodIndexMap[index] = next;
      return next;
    };

    for (let row = 0; row < height - 1; row += 1) {
      for (let col = 0; col < width - 1; col += 1) {
        const a = row * width + col;
        const b = a + 1;
        const c = a + width;
        const d = c + 1;
        if (
          !wetAt(a, level) &&
          !wetAt(b, level) &&
          !wetAt(c, level) &&
          !wetAt(d, level)
        ) {
          continue;
        }
        const va = pushVertex(a);
        const vb = pushVertex(b);
        const vc = pushVertex(c);
        const vd = pushVertex(d);
        waterIndices.push(va, vc, vb, vb, vc, vd);
      }
    }

    floodGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(waterPositions, 3),
    );
    floodGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(waterColors, 4),
    );
    floodGeometry.setIndex(waterIndices);
    floodGeometry.computeVertexNormals();
    floodGeometry.computeBoundingSphere();
    floodedKm2 = wetCells * cellAreaKm2;
  };

  // --- OpenStreetMap roads, coloured by inundation -----------------------
  const roadGroup = new THREE.Group();
  scene.add(roadGroup);

  const intactColor = new THREE.Color('#eef4f8');
  // The railway reads as steel so it is not mistaken for another road.
  const railColor = new THREE.Color('#b8c2cc');
  const severedColor = new THREE.Color('#fb4a45');
  const roadSegments: {
    hand: number;
    start: number;
    km: number;
    intact: THREE.Color;
  }[] = [];
  const roadVertices: number[] = [];
  const roadColors: number[] = [];
  const roadIndices: number[] = [];

  for (const way of meta.roads) {
    const rail = way.klass === 'rail';
    const major = way.klass === 'motorway' || way.klass === 'trunk';
    const halfWidth = (rail ? 18 : major ? 34 : 24) * SCENE_SCALE;
    const intact = rail ? railColor : intactColor;
    for (let i = 0; i < way.points.length - 1; i += 1) {
      const [lon0, lat0] = way.points[i]!;
      const [lon1, lat1] = way.points[i + 1]!;
      const start = worldOf(lon0, lat0, 6);
      const end = worldOf(lon1, lat1, 6);
      const direction = new THREE.Vector2(end.x - start.x, end.z - start.z);
      if (direction.lengthSq() === 0) continue;
      direction.normalize();
      const normal = new THREE.Vector2(
        -direction.y,
        direction.x,
      ).multiplyScalar(halfWidth);
      const base = roadVertices.length / 3;
      for (const [point, side] of [
        [start, 1],
        [start, -1],
        [end, 1],
        [end, -1],
      ] as const) {
        roadVertices.push(
          point.x + normal.x * side,
          point.y,
          point.z + normal.y * side,
        );
        roadColors.push(intact.r, intact.g, intact.b, 0.42);
      }
      roadIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      roadSegments.push({
        hand: Math.min(handAt(lon0, lat0), handAt(lon1, lat1)),
        start: base,
        km: start.distanceTo(end) / SCENE_SCALE / 1000,
        intact,
      });
    }
  }

  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(roadVertices, 3),
  );
  const roadColorAttribute = new THREE.Float32BufferAttribute(roadColors, 4);
  roadGeometry.setAttribute('color', roadColorAttribute);
  roadGeometry.setIndex(roadIndices);
  const roadMesh = new THREE.Mesh(
    roadGeometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  roadMesh.renderOrder = 2;
  roadGroup.add(roadMesh);

  let severedKm = 0;

  const paintRoads = (hour: number) => {
    const level = floodLevelForHour(hour);
    const array = roadColorAttribute.array as Float32Array;
    severedKm = 0;
    for (const segment of roadSegments) {
      const severed = segment.hand !== HAND_DRY && segment.hand / 10 < level;
      if (severed) severedKm += segment.km;
      const tint = severed ? severedColor : segment.intact;
      const alpha = severed ? 0.95 : 0.42;
      for (let corner = 0; corner < 4; corner += 1) {
        const offset = (segment.start + corner) * 4;
        array[offset] = tint.r;
        array[offset + 1] = tint.g;
        array[offset + 2] = tint.b;
        array[offset + 3] = alpha;
      }
    }
    roadColorAttribute.needsUpdate = true;
  };

  // --- Homes, tinted by inundation ---------------------------------------
  const houseGroup = new THREE.Group();
  scene.add(houseGroup);
  const houseCount = terrain.houses.length / 3;
  const houseHeight = elevationToWorldY(HOME_HEIGHT_METRES);
  const houseGeometry = new THREE.BoxGeometry(
    HOME_FOOTPRINT_METRES * SCENE_SCALE,
    houseHeight,
    HOME_FOOTPRINT_METRES * 0.7 * SCENE_SCALE,
  );
  houseGeometry.translate(0, houseHeight / 2, 0);
  const houseMesh = new THREE.InstancedMesh(
    houseGeometry,
    new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }),
    houseCount,
  );
  const houseHand = new Uint8Array(houseCount);
  {
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const unit = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < houseCount; i += 1) {
      const lon = terrain.houses[i * 3]!;
      const lat = terrain.houses[i * 3 + 1]!;
      rotation.setFromAxisAngle(up, terrain.houses[i * 3 + 2]!);
      matrix.compose(worldOf(lon, lat, 1), rotation, unit);
      houseMesh.setMatrixAt(i, matrix);
      houseHand[i] = handAt(lon, lat);
    }
    houseMesh.instanceMatrix.needsUpdate = true;
  }
  houseMesh.renderOrder = 2;
  houseGroup.add(houseMesh);

  const homeColor = new THREE.Color('#f6eddc');
  const floodedHomeColor = new THREE.Color('#fb4a45');
  let homesFlooded = 0;

  const paintHouses = (hour: number) => {
    const level = floodLevelForHour(hour);
    homesFlooded = 0;
    for (let i = 0; i < houseCount; i += 1) {
      const wet = houseHand[i] !== HAND_DRY && houseHand[i]! / 10 < level;
      if (wet) homesFlooded += 1;
      houseMesh.setColorAt(i, wet ? floodedHomeColor : homeColor);
    }
    if (houseMesh.instanceColor) houseMesh.instanceColor.needsUpdate = true;
  };

  // --- Tower and line-of-sight service area ------------------------------
  const towerGroup = new THREE.Group();
  const towerBase = worldOf(meta.towerSite.lon, meta.towerSite.lat);
  towerGroup.position.copy(towerBase);
  scene.add(towerGroup);

  const mastHeight = elevationToWorldY(TOWER_MAST_METRES);
  const mastMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8eef5,
    roughness: 0.45,
    metalness: 0.4,
  });
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(
      mastHeight * 0.05,
      mastHeight * 0.16,
      mastHeight,
      8,
      1,
      true,
    ),
    mastMaterial,
  );
  mast.position.y = mastHeight / 2;
  towerGroup.add(mast);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(mastHeight * 0.09, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x34d399 }),
  );
  beacon.position.y = mastHeight * 1.05;
  towerGroup.add(beacon);

  const coverageGroup = new THREE.Group();
  scene.add(coverageGroup);

  const buildCoverage = () => {
    const spokes = 96;
    const rings = 60;
    const radius = COVERAGE_RADIUS_METRES * SCENE_SCALE;
    const eye = towerBase.y + mastHeight;
    const ringStep = radius / rings;
    const vertices: number[] = [];
    const shades: number[] = [];
    const meshIndices: number[] = [];
    const emerald = new THREE.Color('#34d399');

    for (let s = 0; s < spokes; s += 1) {
      const angle = (s / spokes) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      let horizon = Number.NEGATIVE_INFINITY;
      for (let r = 0; r <= rings; r += 1) {
        const distance = Math.max(r * ringStep, 0.001);
        const x = towerBase.x + dirX * distance;
        const z = towerBase.z + dirZ * distance;
        const groundY = elevationToWorldY(elevationAt(x, z));
        const angleToGround = (groundY - eye) / distance;
        const visible = angleToGround >= horizon - 0.004;
        if (angleToGround > horizon) horizon = angleToGround;
        const falloff = 1 - (distance / radius) ** 2;
        vertices.push(x, groundY + 0.35, z);
        shades.push(
          emerald.r,
          emerald.g,
          emerald.b,
          visible ? 0.14 + 0.36 * falloff : 0,
        );
      }
    }

    for (let s = 0; s < spokes; s += 1) {
      const nextSpoke = (s + 1) % spokes;
      for (let r = 0; r < rings; r += 1) {
        const a = s * (rings + 1) + r;
        const b = a + 1;
        const c = nextSpoke * (rings + 1) + r;
        const d = c + 1;
        meshIndices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(shades, 4));
    geometry.setIndex(meshIndices);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.renderOrder = 3;
    coverageGroup.add(mesh);
  };

  buildCoverage();
  buildFlood(initialHour);
  paintRoads(initialHour);
  paintHouses(initialHour);
  if (status.severed) status.severed.textContent = severedKm.toFixed(1);
  if (status.area) status.area.textContent = floodedKm2.toFixed(1);
  if (status.homes) status.homes.textContent = String(homesFlooded);

  // --- Camera framing ----------------------------------------------------
  // Opens on the valley oblique: Gunung Stong's massif to the south-west,
  // the Sungai Galas running north-east to its confluence at Kuala Krai.
  // Frame the ground between the tower candidate and the centre of mass of
  // the modelled inundation, with the camera behind the tower looking down
  // the valley, so the scene opens on the decision at hand: mast and
  // coverage in the foreground, the severed artery and flood beyond.
  const openingLevel = floodLevelForHour(initialHour);
  let wetX = 0;
  let wetZ = 0;
  let wetCount = 0;
  for (let index = 0; index < vertexCount; index += 1) {
    if (!wetAt(index, openingLevel)) continue;
    wetX += positions[index * 3]!;
    wetZ += positions[index * 3 + 2]!;
    wetCount += 1;
  }
  const focusX = wetCount > 0 ? wetX / wetCount : 0;
  const focusZ = wetCount > 0 ? wetZ / wetCount : 0;
  const homeTarget = new THREE.Vector3(
    (focusX + towerBase.x) / 2,
    elevationToWorldY(
      elevationAt((focusX + towerBase.x) / 2, (focusZ + towerBase.z) / 2),
    ),
    (focusZ + towerBase.z) / 2,
  );
  const orbitDistance = Math.max(g.extentX, g.extentZ) * 0.48;
  const behindTower = new THREE.Vector3(
    towerBase.x - focusX,
    0,
    towerBase.z - focusZ,
  );
  if (behindTower.lengthSq() < 1e-6) behindTower.set(-1.15, 0, 0.9);
  behindTower.normalize().setY(0.62);
  const homePosition = homeTarget
    .clone()
    .add(behindTower.normalize().multiplyScalar(orbitDistance));
  camera.position.copy(homePosition);
  controls.target.copy(homeTarget);
  controls.update();

  // Keep the orbit pivot inside the tile so the view can never wander off
  // into the void. Its height is only re-grounded once a gesture has ended,
  // and gently: snapping it to the terrain mid-pan made the camera heave
  // over every ridge.
  const halfExtentX = g.extentX / 2;
  const halfExtentZ = g.extentZ / 2;
  const clampPivot = (dt: number, gesturing: boolean) => {
    const target = controls.target;
    const x = clamp(target.x, -halfExtentX, halfExtentX);
    const z = clamp(target.z, -halfExtentZ, halfExtentZ);
    const dx = x - target.x;
    const dz = z - target.z;
    let dy = 0;
    if (!gesturing) {
      const groundY = elevationToWorldY(elevationAt(x, z));
      dy = (groundY - target.y) * (1 - Math.exp(-dt / 0.35));
      if (Math.abs(dy) < 1e-4) dy = 0;
    }
    if (dx === 0 && dy === 0 && dz === 0) return;
    target.set(x, target.y + dy, z);
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
  };

  // --- Marker projection -------------------------------------------------
  const anchorPoints = anchors.map((anchor) => ({
    id: anchor.id,
    point: worldOf(anchor.lon, anchor.lat, anchor.liftMetres),
  }));
  const projected = new THREE.Vector3();

  const updateMarkers = () => {
    const viewWidth = container.clientWidth;
    const viewHeight = container.clientHeight;
    for (const anchor of anchorPoints) {
      const element = markerElements.get(anchor.id);
      if (!element) continue;
      projected.copy(anchor.point).project(camera);
      let hidden = projected.z > 1;
      if (!hidden) {
        const steps = 16;
        for (let i = 1; i < steps; i += 1) {
          const t = i / steps;
          const x =
            camera.position.x + (anchor.point.x - camera.position.x) * t;
          const y =
            camera.position.y + (anchor.point.y - camera.position.y) * t;
          const z =
            camera.position.z + (anchor.point.z - camera.position.z) * t;
          if (elevationToWorldY(elevationAt(x, z)) > y + 1.2) {
            hidden = true;
            break;
          }
        }
      }
      element.style.visibility = hidden ? 'hidden' : 'visible';
      element.style.opacity = hidden ? '0' : '1';
      element.style.transform = `translate3d(${
        (projected.x * 0.5 + 0.5) * viewWidth
      }px, ${(-projected.y * 0.5 + 0.5) * viewHeight}px, 0)`;
    }
  };

  // --- Frame loop --------------------------------------------------------
  const reduceMotion = globalThis.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  );
  let lastInteraction = performance.now();
  let frame = 0;
  let running = true;

  const markInteraction = () => {
    lastInteraction = performance.now();
    controls.autoRotate = false;
  };
  controls.addEventListener('start', markInteraction);
  controls.addEventListener('change', markInteraction);

  // A gesture is a live drag, or a wheel/pinch within the last quarter second.
  let dragging = false;
  let gestureUntil = 0;
  const onDragStart = () => {
    dragging = true;
  };
  const onDragEnd = () => {
    dragging = false;
    gestureUntil = performance.now() + GESTURE_TAIL_MS;
  };
  controls.addEventListener('start', onDragStart);
  controls.addEventListener('end', onDragEnd);

  // --- Trackpad gestures -------------------------------------------------
  // Pinch (ctrl+wheel on macOS) zooms toward the ground under the pointer;
  // a plain two-finger scroll flies the camera up and down (vertical) and
  // orbits the pivot (horizontal). Each gesture feeds a goal that the frame
  // loop eases toward, so nothing steps the way OrbitControls' instant
  // per-event dolly does.
  let zoomGoalLog = Math.log(camera.position.distanceTo(controls.target));
  let zoomActive = false;
  let orbitPending = 0; // radians of azimuth still to apply
  let flyPending = 0; // fraction of camera height still to apply
  const orbitOffset = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const zoomAnchor = new THREE.Vector3();
  let zoomAnchorValid = false;
  const wheelRay = new THREE.Vector3();
  const probe = new THREE.Vector3();

  const belowGround = (point: THREE.Vector3) =>
    point.y <= elevationToWorldY(elevationAt(point.x, point.z));

  const groundUnderPointer = (
    clientX: number,
    clientY: number,
    out: THREE.Vector3,
  ) => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    wheelRay
      .set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
        0.5,
      )
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    // March until the ray dips under the terrain, then bisect the last step.
    const reach = 2400;
    const steps = 96;
    let previous = 0;
    for (let i = 1; i <= steps; i += 1) {
      const t = (i / steps) * reach;
      probe.copy(camera.position).addScaledVector(wheelRay, t);
      if (
        Math.abs(probe.x) > halfExtentX + 100 ||
        Math.abs(probe.z) > halfExtentZ + 100
      ) {
        return false;
      }
      if (belowGround(probe)) {
        let low = previous;
        let high = t;
        for (let k = 0; k < 8; k += 1) {
          const mid = (low + high) / 2;
          probe.copy(camera.position).addScaledVector(wheelRay, mid);
          if (belowGround(probe)) high = mid;
          else low = mid;
        }
        out.copy(camera.position).addScaledVector(wheelRay, high);
        return true;
      }
      previous = t;
    }
    return false;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    const deltaX = event.deltaX * unit;
    const deltaY = event.deltaY * unit;
    if (event.ctrlKey) {
      // macOS pinch arrives as ctrl+wheel with tiny deltas.
      zoomGoalLog = clamp(
        zoomGoalLog + deltaY * 8 * WHEEL_ZOOM_RATE,
        Math.log(controls.minDistance),
        Math.log(controls.maxDistance),
      );
      zoomActive = true;
      zoomAnchorValid = groundUnderPointer(
        event.clientX,
        event.clientY,
        zoomAnchor,
      );
    } else {
      // Two-finger scroll: sideways orbits, up and down flies. Signs follow
      // natural scrolling so the world moves with the fingers.
      orbitPending += deltaX * SWIPE_ORBIT_RATE;
      flyPending -= deltaY * SWIPE_FLY_RATE;
    }
    gestureUntil = performance.now() + GESTURE_TAIL_MS;
    markInteraction();
  };
  // Capture on the container so this runs before OrbitControls' own wheel
  // handler on the canvas; touch pinch still goes through OrbitControls.
  container.addEventListener('wheel', onWheel, {
    passive: false,
    capture: true,
  });

  const applyGestures = (dt: number) => {
    const ease = 1 - Math.exp(-dt / GESTURE_EASE_SECONDS);

    // Zoom toward the anchor.
    const current = camera.position.distanceTo(controls.target);
    if (!zoomActive) {
      // Follow touch pinch and programmatic moves so the next wheel starts here.
      zoomGoalLog = Math.log(current);
    } else {
      const goal = Math.exp(zoomGoalLog);
      if (Math.abs(goal - current) < 0.02) {
        zoomActive = false;
      } else {
        const next = current + (goal - current) * ease;
        const scale = next / current;
        const pivot = zoomAnchorValid ? zoomAnchor : controls.target;
        controls.target.sub(pivot).multiplyScalar(scale).add(pivot);
        camera.position.sub(pivot).multiplyScalar(scale).add(pivot);
      }
    }

    // Orbit around the pivot.
    if (Math.abs(orbitPending) > 1e-5) {
      const step = orbitPending * ease;
      orbitPending -= step;
      orbitOffset.copy(camera.position).sub(controls.target);
      orbitOffset.applyAxisAngle(worldUp, step);
      camera.position.copy(controls.target).add(orbitOffset);
    } else {
      orbitPending = 0;
    }

    // Fly up or down: move the camera vertically over the same pivot. The
    // polar and distance limits in OrbitControls keep it above the ground
    // and inside the zoom range.
    if (Math.abs(flyPending) > 1e-5) {
      const step = flyPending * ease;
      flyPending -= step;
      const height = Math.max(camera.position.y - controls.target.y, 4);
      camera.position.y += height * step;
    } else {
      flyPending = 0;
    }
  };

  // --- Adaptive resolution -----------------------------------------------
  // Start below full Retina density and let measured frame times decide:
  // step down when frames run long, creep back up when they stay short,
  // and shave a little more during a gesture so dragging always feels light.
  const maxRatio = Math.min(deviceRatio, 2);
  let baseRatio = Math.min(deviceRatio, 1.5);
  let appliedRatio = 0;
  const frameTimes: number[] = [];
  let calmMs = 0;

  const applyRatio = (ratio: number) => {
    if (Math.abs(ratio - appliedRatio) < 0.01) return;
    appliedRatio = ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(
      container.clientWidth,
      Math.max(container.clientHeight, 1),
      false,
    );
  };

  const adaptResolution = (dtMs: number, gesturing: boolean) => {
    frameTimes.push(dtMs);
    if (frameTimes.length > FRAME_SAMPLE) frameTimes.shift();
    let sum = 0;
    for (const value of frameTimes) sum += value;
    const average = sum / frameTimes.length;
    if (frameTimes.length === FRAME_SAMPLE && average > 18 && baseRatio > 1) {
      baseRatio = Math.max(1, baseRatio - 0.25);
      frameTimes.length = 0;
      calmMs = 0;
    } else if (average < 9) {
      calmMs += dtMs;
      if (calmMs > 2000 && baseRatio < maxRatio) {
        baseRatio = Math.min(maxRatio, baseRatio + 0.25);
        frameTimes.length = 0;
        calmMs = 0;
      }
    } else {
      calmMs = 0;
    }
    applyRatio(gesturing ? Math.max(1, baseRatio * 0.8) : baseRatio);
  };

  let lastFrameTime = performance.now();

  const renderFrame = () => {
    frame = requestAnimationFrame(renderFrame);
    const now = performance.now();
    const dtMs = Math.min(now - lastFrameTime, 50);
    lastFrameTime = now;
    const dt = dtMs / 1000;
    const gesturing = dragging || now < gestureUntil;
    const idle = now - lastInteraction > IDLE_DRIFT_DELAY;
    controls.autoRotate = idle && !reduceMotion?.matches;
    // OrbitControls damps per update() call; scale the factor by the frame
    // interval so the feel is the same at 60 Hz and on a 120 Hz display.
    controls.dampingFactor = 1 - Math.pow(1 - BASE_DAMPING, dtMs / (1000 / 60));
    applyGestures(dt);
    controls.update(dt);
    clampPivot(dt, gesturing);
    adaptResolution(dtMs, gesturing);
    updateMarkers();
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(renderFrame);

  const resize = () => {
    const viewWidth = container.clientWidth;
    const viewHeight = Math.max(container.clientHeight, 1);
    camera.aspect = viewWidth / viewHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewWidth, viewHeight, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  const onVisibility = () => {
    if (document.hidden && running) {
      cancelAnimationFrame(frame);
      running = false;
    } else if (!document.hidden && !running) {
      running = true;
      lastInteraction = performance.now();
      lastFrameTime = performance.now();
      frameTimes.length = 0;
      frame = requestAnimationFrame(renderFrame);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    setLayers(layers) {
      floodMesh.visible = layers.flood;
      roadGroup.visible = layers.roads;
      coverageGroup.visible = layers.coverage;
      towerGroup.visible = layers.towers;
      houseGroup.visible = layers.population;
    },
    setHour(hour) {
      buildFlood(hour);
      paintRoads(hour);
      paintHouses(hour);
      if (status.severed) status.severed.textContent = severedKm.toFixed(1);
      if (status.area) status.area.textContent = floodedKm2.toFixed(1);
      if (status.homes) status.homes.textContent = String(homesFlooded);
    },
    resetView() {
      camera.position.copy(homePosition);
      controls.target.copy(homeTarget);
      zoomActive = false;
      zoomAnchorValid = false;
      orbitPending = 0;
      flyPending = 0;
      controls.update();
      lastInteraction = performance.now();
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      container.removeEventListener('wheel', onWheel, { capture: true });
      controls.removeEventListener('start', markInteraction);
      controls.removeEventListener('change', markInteraction);
      controls.removeEventListener('start', onDragStart);
      controls.removeEventListener('end', onDragEnd);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) {
            for (const entry of material) entry.dispose();
          } else {
            material.dispose();
          }
        }
      });
      surfaceTexture.dispose();
      sky.dispose();
      scene.background = null;
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export function Terrain3D({
  layers,
  timeline,
  resetSignal,
}: {
  layers: Record<LayerKey, boolean>;
  timeline: number;
  resetSignal: number;
}) {
  // The baked assets are fetched from the client only: this component is
  // prerendered during the static export, where a relative URL has no origin.
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef(new Map<string, HTMLDivElement>());
  const severedRef = useRef<HTMLSpanElement>(null);
  const areaRef = useRef<HTMLSpanElement>(null);
  const homesRef = useRef<HTMLSpanElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const timelineRef = useRef(timeline);
  const anchors = useMemo(
    () => (terrain ? deriveAnchors(terrain) : []),
    [terrain],
  );

  useEffect(() => {
    let cancelled = false;
    terrainResource().then(
      (data) => {
        if (!cancelled) setTerrain(data);
      },
      (error: unknown) => {
        console.error('Failed to load terrain assets', error);
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !terrain) return;
    const handle = createScene(
      container,
      terrain,
      anchors,
      markerRefs.current,
      {
        severed: severedRef.current,
        area: areaRef.current,
        homes: homesRef.current,
      },
      timelineRef.current,
    );
    sceneRef.current = handle;
    return () => {
      sceneRef.current = null;
      handle.dispose();
    };
  }, [terrain, anchors]);

  // The scene only exists once the terrain assets arrive, so these must
  // re-run at that point as well as when the control changes.
  useEffect(() => {
    sceneRef.current?.setLayers(layers);
  }, [layers, terrain]);

  useEffect(() => {
    timelineRef.current = timeline;
    sceneRef.current?.setHour(timeline);
  }, [timeline, terrain]);

  useEffect(() => {
    if (resetSignal > 0) sceneRef.current?.resetView();
  }, [resetSignal]);

  const registerMarker = (id: string) => (element: HTMLDivElement | null) => {
    if (element) {
      markerRefs.current.set(id, element);
    } else {
      markerRefs.current.delete(id);
    }
  };

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="size-full" />
      {!terrain && (
        <p className="absolute inset-x-0 top-1/2 text-center text-xs font-medium tracking-[0.08em] text-white/70 uppercase">
          {failed ? 'Terrain assets unavailable' : 'Loading terrain model…'}
        </p>
      )}
      <div className="pointer-events-none absolute top-[132px] right-6 z-20 hidden items-center gap-1.5 xl:right-[360px] rounded-lg border border-red-300/20 bg-red-950/70 px-2.5 py-2 text-[11px] font-medium text-red-100 backdrop-blur-md lg:flex">
        <TriangleAlert className="size-3.5 text-red-300" aria-hidden />
        <span ref={severedRef} className="tabular-nums">
          0
        </span>
        km of road & rail cut ·
        <span ref={areaRef} className="tabular-nums">
          0
        </span>
        km² inundated ·
        <span ref={homesRef} className="tabular-nums">
          0
        </span>
        homes flooded
      </div>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {anchors.map((anchor) => {
          const visible =
            anchor.kind === 'tower' ? layers.towers : layers.population;
          if (!visible) return null;
          return (
            <div
              key={anchor.id}
              ref={registerMarker(anchor.id)}
              className="map-marker absolute left-0 top-0 transition-opacity duration-150 will-change-transform"
            >
              {anchor.kind === 'tower' ? (
                <div className="flex -translate-x-1/2 -translate-y-full flex-col items-center">
                  <div className="mb-2 whitespace-nowrap rounded-lg border border-emerald-300/35 bg-[#07131d]/90 px-3 py-2 shadow-xl backdrop-blur-md">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <RadioTower
                        className="size-4 text-emerald-300"
                        aria-hidden
                      />
                      {anchor.label}
                    </div>
                    <div className="mt-0.5 pl-6 text-xs text-slate-300">
                      {anchor.detail}
                    </div>
                  </div>
                  <div className="grid size-9 place-items-center rounded-full border-2 border-white bg-emerald-400 text-emerald-950 shadow-[0_0_0_7px_rgb(52_211_153/18%)]">
                    <RadioTower className="size-4" aria-hidden />
                  </div>
                </div>
              ) : (
                <div className="flex -translate-x-1/2 -translate-y-full flex-col items-center">
                  <span className="mb-1.5 whitespace-nowrap rounded-md border border-sky-200/30 bg-[#07131d]/85 px-2 py-1 text-xs font-semibold text-sky-100 backdrop-blur-sm">
                    {anchor.label} ({anchor.detail})
                  </span>
                  <MapPin
                    className="size-7 fill-sky-400 text-white"
                    aria-hidden
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
