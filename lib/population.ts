/**
 * Populated render cells from the baked WorldPop raster: the one list every
 * "people" count in the app iterates over. Cells with nobody in them are
 * skipped, which keeps coverage and hole counts cheap.
 */

import type { TerrainData } from './terrain-field.ts';

export type PopulatedCells = {
  count: number;
  lon: Float64Array;
  lat: Float64Array;
  people: Float32Array;
  /** Everyone in the AOI. */
  total: number;
};

const cache = new WeakMap<TerrainData, PopulatedCells>();

export function populatedCells(terrain: TerrainData): PopulatedCells {
  const cached = cache.get(terrain);
  if (cached) return cached;
  const { population, width, height, meta } = terrain;
  const { aoi } = meta;
  const lonStep = (aoi.east - aoi.west) / width;
  const latStep = (aoi.north - aoi.south) / height;
  let count = 0;
  for (let i = 0; i < population.length; i += 1) if (population[i]! > 0) count += 1;
  const lon = new Float64Array(count);
  const lat = new Float64Array(count);
  const people = new Float32Array(count);
  let k = 0;
  let total = 0;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const value = population[row * width + col]!;
      if (!(value > 0)) continue;
      lon[k] = aoi.west + (col + 0.5) * lonStep;
      lat[k] = aoi.north - (row + 0.5) * latStep;
      people[k] = value;
      total += value;
      k += 1;
    }
  }
  const cells = { count, lon, lat, people, total };
  cache.set(terrain, cells);
  return cells;
}

/** People within `radiusMetres` of a point. */
export function peopleNear(terrain: TerrainData, lon: number, lat: number, radiusMetres: number) {
  const cells = populatedCells(terrain);
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < cells.count; i += 1) {
    const dx = (cells.lon[i]! - lon) * kx;
    const dy = (cells.lat[i]! - lat) * 110_574;
    if (dx * dx + dy * dy <= radiusMetres * radiusMetres) sum += cells.people[i]!;
  }
  return sum;
}
