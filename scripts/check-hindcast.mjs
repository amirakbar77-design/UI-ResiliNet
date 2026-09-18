/**
 * The December 2014 hindcast, printed: the four reported facts against the
 * model at the recorded 34.2 m peak, then what the river constants would
 * have to be to reproduce that peak from ERA5-Land rain — and why they are
 * not adopted.
 *
 *   node scripts/check-hindcast.mjs [gaugeMetres]   (default 34.2)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BASE_LEVEL, floodCurve, LAG_HOURS, MAX_LEVEL, MIN_LEVEL, RECESSION, RUNOFF_COEF } from '../lib/forecast.ts';
import { HINDCAST_2014, hindcastChecks } from '../lib/hindcast.ts';
import { assessNetwork, siteViewsheds } from '../lib/network.ts';

const gauge = Number(process.argv[2] ?? HINDCAST_2014.gauge);
const level = Math.min(14, Math.max(0.5, gauge - 25));
const meta = JSON.parse(await readFile(path.resolve('public/terrain/terrain.json'), 'utf8'));
const graph = JSON.parse(await readFile(path.resolve('public/terrain', meta.roads.file), 'utf8'));
const forecast2014 = JSON.parse(await readFile(path.resolve('public/forecast-2014.json'), 'utf8'));
const forecast2024 = JSON.parse(await readFile(path.resolve('public/forecast-2024.json'), 'utf8'));
const bin = async (file) => {
  const b = await readFile(path.resolve('public/terrain', file));
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

const curve = floodCurve(forecast2014, level);
const network = assessNetwork(terrain, curve);
const masks = siteViewsheds(terrain);
const checks = hindcastChecks(terrain, network, masks, level);

console.log(`December 2014 hindcast · gauge ${gauge.toFixed(1)} m (HAND ${level.toFixed(1)} m) · ${forecast2014.source}`);
console.log(`sites at the peak: ${network.summary.up} up · ${network.summary.battery} on battery · ${network.summary.down} down · ${network.darkAt(8)} of ${network.summary.total} dark by +8 h · ${network.darkAt(network.outageHour ?? 0)} dark by +${network.outageHour} h\n`);
const glyph = { hit: 'HIT ', partial: 'PART', miss: 'MISS' };
for (const c of checks) {
  console.log(`${glyph[c.verdict]}  ${c.fact}`);
  console.log(`      reported: ${c.source}`);
  console.log(`      model:    ${c.model}\n`);
}

// --- Calibration, stated rather than applied -------------------------------
// The leaky store with its own constants, so alternatives can be tried here
// without touching lib/forecast.ts.
const store = (mean, hours, start, runoff, recession) => {
  const levels = [Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, start))];
  for (let h = 1; h < hours; h += 1) {
    const previous = levels[h - 1];
    const inflow = mean[Math.max(0, h - LAG_HOURS)] ?? 0;
    levels.push(Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, previous + runoff * inflow - recession * (previous - BASE_LEVEL))));
  }
  return levels;
};
const peak = (levels) => Math.max(...levels);
const target = HINDCAST_2014.gauge - 25;
const from2014 = store(forecast2014.catchmentMeanMmPerHour, forecast2014.hours, MIN_LEVEL, RUNOFF_COEF, RECESSION);
console.log(`river model as shipped (RUNOFF_COEF ${RUNOFF_COEF}, RECESSION ${RECESSION}): from danger level on 22 Dec 06Z the ERA5-Land rain lifts the river to HAND ${peak(from2014).toFixed(2)} m (gauge ${(25 + peak(from2014)).toFixed(1)}); the record was ${HINDCAST_2014.gauge} m`);
let needed = null;
for (let a = RUNOFF_COEF; a <= 5; a = Math.round((a + 0.01) * 100) / 100) {
  if (peak(store(forecast2014.catchmentMeanMmPerHour, forecast2014.hours, MIN_LEVEL, a, RECESSION)) >= target) {
    needed = a;
    break;
  }
}
if (needed === null) {
  console.log('no RUNOFF_COEF up to 5 reaches the record with RECESSION as shipped');
} else {
  const replay = store(forecast2024.catchmentMeanMmPerHour, forecast2024.hours, MIN_LEVEL, needed, RECESSION);
  const at56 = replay[56];
  console.log(`to reach the record with RECESSION ${RECESSION}, RUNOFF_COEF would have to be ${needed} (${(needed / RUNOFF_COEF).toFixed(1)}× as shipped)`);
  console.log(`with that coefficient the Nov 2024 replay from danger level would read gauge ${(25 + at56).toFixed(1)} m at +56 h (29 Nov 08:00 MYT), peak ${(25 + peak(replay)).toFixed(1)} m; Bernama reported 25.17 m at Kuala Krai at that hour`);
  console.log('one linear coefficient cannot fit both events: ERA5-Land understates the 2014 rain and the stage–discharge relation is not linear. Not adopted; see README.');
}
