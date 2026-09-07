/**
 * Loader and coordinate helpers for the baked terrain assets.
 *
 * The assets under `public/terrain/` are produced by `npm run bake:terrain`
 * from NASA SRTM elevation, Sentinel-2 cloudless imagery, and OpenStreetMap
 * context. Nothing here fetches a remote service at runtime.
 */

export type LayerKey = 'coverage' | 'towers' | 'flood' | 'roads' | 'population';

export type Aoi = {
  west: number;
  east: number;
  south: number;
  north: number;
};

export type RoadWay = {
  klass: string;
  points: [number, number][];
};

export type Place = {
  name: string;
  lon: number;
  lat: number;
  place: string;
};

export type TowerSite = {
  lon: number;
  lat: number;
  elevation: number;
  name: string;
};

export type TerrainMeta = {
  aoi: Aoi;
  grid: { width: number; height: number; spacingMetres: number };
  elevation: { min: number; max: number };
  hand: { dryValue: number };
  texture: { file: string; size: number };
  roads: RoadWay[];
  places: Place[];
  towerSite: TowerSite;
  attribution: string[];
};

export type TerrainData = {
  meta: TerrainMeta;
  /** Metres above sea level, row-major, north row first. */
  elevation: Int16Array;
  /** Height above nearest drainage in decimetres; 255 means dry or sea. */
  hand: Uint8Array;
  surface: ImageBitmap;
  width: number;
  height: number;
};

/** World units per metre. One unit is 50 m, keeping the scene camera-sized. */
export const SCENE_SCALE = 0.02;
/** Relief exaggeration, in the same spirit as the concept's earlier DEM draft. */
export const VERTICAL_EXAGGERATION = 1.9;
export const HAND_DRY = 255;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Scenario hour to a HAND threshold in metres, matching the legend's range. */
export function floodLevelForHour(hour: number) {
  return 0.2 + (clamp(hour, 0, 16) / 16) * 2.4;
}

export const mercatorX = (lon: number) => lon / 360 + 0.5;

export const mercatorY = (lat: number) => {
  const phi = (lat * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / (2 * Math.PI);
};

const METRES_PER_DEGREE_LAT = 110_574;

export function metresPerDegreeLon(lat: number) {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

/** Scene geometry derived from the AOI: spacing, extent, and origin. */
export function sceneGrid(meta: TerrainMeta) {
  const { aoi, grid } = meta;
  const centreLat = (aoi.north + aoi.south) / 2;
  const lonStep = (aoi.east - aoi.west) / grid.width;
  const latStep = (aoi.north - aoi.south) / grid.height;
  const xStep = lonStep * metresPerDegreeLon(centreLat) * SCENE_SCALE;
  const zStep = latStep * METRES_PER_DEGREE_LAT * SCENE_SCALE;
  return {
    lonStep,
    latStep,
    xStep,
    zStep,
    centreLat,
    width: grid.width,
    height: grid.height,
    extentX: xStep * (grid.width - 1),
    extentZ: zStep * (grid.height - 1),
  };
}

export type SceneGrid = ReturnType<typeof sceneGrid>;

/** Longitude/latitude to scene x/z, with north at -z. */
export function lonLatToWorld(meta: TerrainMeta, lon: number, lat: number) {
  const g = sceneGrid(meta);
  const col = (lon - meta.aoi.west) / g.lonStep;
  const row = (meta.aoi.north - lat) / g.latStep;
  return {
    x: (col - (g.width - 1) / 2) * g.xStep,
    z: (row - (g.height - 1) / 2) * g.zStep,
    col,
    row,
  };
}

/** Texture coordinates for the mercator-projected Sentinel-2 drape. */
export function mercatorUv(meta: TerrainMeta, lon: number, lat: number) {
  const { aoi } = meta;
  const x0 = mercatorX(aoi.west);
  const x1 = mercatorX(aoi.east);
  const y0 = mercatorY(aoi.north);
  const y1 = mercatorY(aoi.south);
  return {
    u: (mercatorX(lon) - x0) / (x1 - x0),
    v: (mercatorY(lat) - y0) / (y1 - y0),
  };
}

export function elevationToWorldY(metres: number) {
  return metres * VERTICAL_EXAGGERATION * SCENE_SCALE;
}

async function loadBinary(url: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.arrayBuffer();
}

async function loadImageBitmap(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return createImageBitmap(await response.blob());
}

export async function loadTerrain(base = '/terrain'): Promise<TerrainData> {
  console.log('TRACE loadTerrain start');
  const metaResponse = await fetch(`${base}/terrain.json`);
  if (!metaResponse.ok) {
    throw new Error(`Failed to load terrain metadata: ${metaResponse.status}`);
  }
  const meta = (await metaResponse.json()) as TerrainMeta;
  console.log('TRACE meta ok');
  const [elevationBuffer, handBuffer, surface] = await Promise.all([
    loadBinary(`${base}/elevation.bin`),
    loadBinary(`${base}/hand.bin`),
    loadImageBitmap(`${base}/${meta.texture.file}`),
  ]);

  console.log('TRACE binaries ok');
  return {
    meta,
    elevation: new Int16Array(elevationBuffer),
    hand: new Uint8Array(handBuffer),
    surface,
    width: meta.grid.width,
    height: meta.grid.height,
  };
}

let pending: Promise<TerrainData> | null = null;

/** Suspense-friendly singleton so the fetch survives re-renders. */
export function terrainResource() {
  pending ??= loadTerrain();
  return pending;
}
