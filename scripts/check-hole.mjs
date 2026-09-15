/**
 * Prints the coverage hole — homes with signal now and none at the planned
 * hour — across gauge readings, to show it moves only when sites fail:
 *
 *   node scripts/check-hole.mjs [gauge ...]   (default 26 26.5 27 28 30 32)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { floodCurve } from '../lib/forecast.ts';
import { assessNetwork, coverageHole, siteViewsheds } from '../lib/network.ts';

const meta = JSON.parse(await readFile(path.resolve('public/terrain/terrain.json'), 'utf8'));
const graph = JSON.parse(await readFile(path.resolve('public/terrain', meta.roads.file), 'utf8'));
const forecast = JSON.parse(await readFile(path.resolve('public/forecast.json'), 'utf8'));
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
  width: meta.grid.width,
  height: meta.grid.height,
};
const masks = siteViewsheds(terrain);
const gauges = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (gauges.length === 0) gauges.push(26, 26.5, 27, 28, 30, 32);
console.log('gauge   HAND   river peak   outage    dark@outage   covered now   without signal @outage');
for (const gauge of gauges) {
  const level = Math.min(14, Math.max(0.5, gauge - 25));
  const curve = floodCurve(forecast, level);
  const network = assessNetwork(terrain, curve);
  const planHour = network.outageHour ?? curve.peakHour();
  const hole = coverageHole(terrain, masks, network, planHour);
  console.log(
    `${gauge.toFixed(1).padStart(5)}  ${level.toFixed(1).padStart(5)}      +${String(curve.peakHour()).padStart(2)} h    ${(network.outageHour === null ? 'none' : '+' + network.outageHour + ' h').padStart(6)}      ${String(network.darkAt(planHour)).padStart(2)} of ${network.summary.total}        ${String(hole.coveredNow).padStart(6)}          ${String(hole.count).padStart(6)}`,
  );
}
