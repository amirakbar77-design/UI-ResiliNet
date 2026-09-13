/**
 * Line-of-sight viewshed over the baked terrain, shared by the drawn coverage
 * fans and the site evaluation so both agree on what a mast can see.
 */

import { clamp, metresPerDegreeLon, type TerrainData } from './terrain-field';

export const VIEWSHED_SPOKES = 96;
export const VIEWSHED_RINGS = 60;
const METRES_PER_DEGREE_LAT = 110_574;
/** Slack in the horizon test (rise per metre) so grazing samples are kept. */
const HORIZON_SLACK = 0.0015;

/** Bilinear ground elevation in metres at a longitude/latitude. */
export function elevationAtLonLat(terrain: TerrainData, lon: number, lat: number) {
  const { meta, elevation, width, height } = terrain;
  const { aoi } = meta;
  const col = clamp(((lon - aoi.west) / (aoi.east - aoi.west)) * width, 0, width - 1.001);
  const row = clamp(((aoi.north - lat) / (aoi.north - aoi.south)) * height, 0, height - 1.001);
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const tc = col - c0;
  const tr = row - r0;
  const e00 = elevation[r0 * width + c0]!;
  const e10 = elevation[r0 * width + c0 + 1]!;
  const e01 = elevation[(r0 + 1) * width + c0]!;
  const e11 = elevation[(r0 + 1) * width + c0 + 1]!;
  return (
    e00 * (1 - tc) * (1 - tr) + e10 * tc * (1 - tr) + e01 * (1 - tc) * tr + e11 * tc * tr
  );
}

/** Nearest-cell HAND in decimetres (255 = dry) at a longitude/latitude. */
export function handAtLonLat(terrain: TerrainData, lon: number, lat: number) {
  const { meta, hand, width, height } = terrain;
  const { aoi } = meta;
  const col = clamp(Math.round(((lon - aoi.west) / (aoi.east - aoi.west)) * width), 0, width - 1);
  const row = clamp(Math.round(((aoi.north - lat) / (aoi.north - aoi.south)) * height), 0, height - 1);
  return hand[row * width + col]!;
}

export type ViewshedMask = {
  site: { lon: number; lat: number };
  spokes: number;
  rings: number;
  radiusMetres: number;
  /** 1 where sample (spoke * (rings + 1) + ring) has line of sight to the mast. */
  visible: Uint8Array;
  /** Whether a point is inside the radius and in view of the mast. */
  covers: (lon: number, lat: number) => boolean;
};

/**
 * Marches VIEWSHED_SPOKES rays out to `radiusMetres`, keeping the steepest
 * angle seen so far on each ray; a sample is visible when the ground there
 * rises at least as steeply as everything before it. Sample layout matches
 * the scene's coverage fan: spoke 0 points east and spokes turn clockwise
 * on the map (toward south).
 */
export function viewshedMask(
  terrain: TerrainData,
  site: { lon: number; lat: number },
  mastMetres: number,
  radiusMetres: number,
): ViewshedMask {
  const spokes = VIEWSHED_SPOKES;
  const rings = VIEWSHED_RINGS;
  const eye = elevationAtLonLat(terrain, site.lon, site.lat) + mastMetres;
  const kx = metresPerDegreeLon(site.lat);
  const ringStep = radiusMetres / rings;
  const visible = new Uint8Array(spokes * (rings + 1));

  for (let s = 0; s < spokes; s += 1) {
    const angle = (s / spokes) * Math.PI * 2;
    const east = Math.cos(angle);
    const south = Math.sin(angle);
    let horizon = Number.NEGATIVE_INFINITY;
    for (let r = 0; r <= rings; r += 1) {
      const distance = Math.max(r * ringStep, 0.001);
      const lon = site.lon + (east * distance) / kx;
      const lat = site.lat - (south * distance) / METRES_PER_DEGREE_LAT;
      const slope = (elevationAtLonLat(terrain, lon, lat) - eye) / distance;
      if (slope >= horizon - HORIZON_SLACK) visible[s * (rings + 1) + r] = 1;
      if (slope > horizon) horizon = slope;
    }
  }

  const covers = (lon: number, lat: number) => {
    const east = (lon - site.lon) * kx;
    const south = -(lat - site.lat) * METRES_PER_DEGREE_LAT;
    const distance = Math.hypot(east, south);
    if (distance > radiusMetres) return false;
    let angle = Math.atan2(south, east);
    if (angle < 0) angle += Math.PI * 2;
    const s = Math.round(angle / ((Math.PI * 2) / spokes)) % spokes;
    const r = Math.min(rings, Math.round(distance / ringStep));
    return visible[s * (rings + 1) + r] === 1;
  };

  return { site, spokes, rings, radiusMetres, visible, covers };
}
