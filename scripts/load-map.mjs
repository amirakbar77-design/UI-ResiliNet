/**
 * Loads one map's baked assets and model constants for the check scripts, so
 * every check can run against any valley rather than only the first one.
 *
 * The scripts take the map id as their first argument and default to
 * `kelantan`, which keeps the old `node scripts/check-sites.mjs 27` working.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MIN_LEVEL, RECESSION } from '../lib/forecast.ts';
import { gaugeToHandLevel } from '../lib/gauge.ts';
import { isMapId, MAPS } from '../lib/maps.ts';

/**
 * Splits `[mapId] [rest...]` from argv, defaulting the map when the first
 * argument is plainly not one.
 */
export function mapArg(argv = process.argv.slice(2)) {
  if (argv.length > 0 && isMapId(argv[0])) return { mapId: argv[0], rest: argv.slice(1) };
  return { mapId: 'kelantan', rest: argv };
}

export async function loadMap(mapId = 'kelantan') {
  const map = MAPS[mapId];
  if (!map) {
    throw new Error(`Unknown map "${mapId}". Known: ${Object.keys(MAPS).join(', ')}`);
  }
  const dir = path.resolve('public', map.assetBase.replace(/^\//, ''));
  const meta = JSON.parse(await readFile(path.join(dir, 'terrain.json'), 'utf8'));
  const graph = JSON.parse(await readFile(path.join(dir, meta.roads.file), 'utf8'));
  const bin = async (file) => {
    const b = await readFile(path.join(dir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  const terrain = {
    meta,
    graph,
    elevation: new Int16Array(await bin('elevation.bin')),
    hand: new Uint8Array(await bin('hand.bin')),
    houses: new Float32Array(await bin(meta.houses.file)),
    population: new Float32Array(await bin(meta.population.file)),
    width: meta.grid.width,
    height: meta.grid.height,
  };

  const forecastFile = async (mode) => {
    const url = map.forecastFiles[mode] ?? map.forecastFiles.scenario;
    return JSON.parse(
      await readFile(path.resolve('public', url.replace(/^\//, '')), 'utf8'),
    );
  };

  return {
    map,
    terrain,
    forecastFile,
    forecast: await forecastFile('scenario'),
    // The station's own stage response, matching what the app runs.
    river: {
      runoffCoef: map.gauge.runoffCoef,
      recession: RECESSION,
      lagHours: map.gauge.lagHours,
      baseLevel: MIN_LEVEL,
    },
    levelOf: (gauge) => gaugeToHandLevel(gauge, map.gauge),
  };
}
