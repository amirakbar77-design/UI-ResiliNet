/**
 * Prints the coverage hole — people with signal now and none at the planned
 * hour — across gauge readings, to show it moves only when sites fail. The
 * last columns count the illustrative houses the same way, for comparison
 * with the WorldPop people counts:
 *
 *   node scripts/check-hole.mjs [gauge ...]   (default 26 26.5 27 28 30 32)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { floodCurve } from '../lib/forecast.ts';
import { assessNetwork, coverageAt, coverageHole, siteViewsheds } from '../lib/network.ts';

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
  population: new Float32Array(await bin(meta.population.file)),
  width: meta.grid.width,
  height: meta.grid.height,
};
const masks = siteViewsheds(terrain);
const gauges = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (gauges.length === 0) gauges.push(26, 26.5, 27, 28, 30, 32);
console.log(`population ${meta.population.total.toLocaleString()} people · illustrative houses ${meta.houses.count.toLocaleString()}`);
console.log('gauge   HAND   river peak   outage    dark@outage   covered now   without signal @outage   homes now   homes without signal');
const homesHole = (network, hour) => {
  const now = coverageAt(masks, network.liveAt(0));
  const later = coverageAt(masks, network.liveAt(hour));
  let covered = 0;
  let lost = 0;
  for (let i = 0; i < terrain.houses.length; i += 3) {
    const lon = terrain.houses[i];
    const lat = terrain.houses[i + 1];
    if (!now.covers(lon, lat)) continue;
    covered += 1;
    if (!later.covers(lon, lat)) lost += 1;
  }
  return { covered, lost };
};
for (const gauge of gauges) {
  const level = Math.min(14, Math.max(0.5, gauge - 25));
  const curve = floodCurve(forecast, level);
  const network = assessNetwork(terrain, curve);
  const planHour = network.outageHour ?? curve.peakHour();
  const hole = coverageHole(terrain, masks, network, planHour);
  const homes = homesHole(network, planHour);
  console.log(
    `${gauge.toFixed(1).padStart(5)}  ${level.toFixed(1).padStart(5)}      +${String(curve.peakHour()).padStart(2)} h    ${(network.outageHour === null ? 'none' : '+' + network.outageHour + ' h').padStart(6)}      ${String(network.darkAt(planHour)).padStart(2)} of ${network.summary.total}        ${String(hole.coveredNow).padStart(6)}          ${String(hole.count).padStart(6)}               ${String(homes.covered).padStart(5)}       ${String(homes.lost).padStart(5)}`,
  );
}
