/**
 * Prints the plan in two tiers for a gauge reading: the baseline top-ups and
 * the residual hole they leave, then the convoy options, the portable-tower
 * candidates with their microwave links, and the ranked plans:
 *
 *   node scripts/check-sites.mjs [gaugeMetres]   (default 27.0)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { floodCurve } from '../lib/forecast.ts';
import { assessNetwork, siteViewsheds } from '../lib/network.ts';
import { baselineTopUps, convoyOptions, recommendPlans } from '../lib/recommend.ts';
import { evaluateRoutes } from '../lib/routing.ts';
import { assessSites } from '../lib/sites.ts';

const gauge = Number(process.argv[2] ?? 27);
const level = Math.min(14, Math.max(0.5, gauge - 25));
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
const curve = floodCurve(forecast, level);
const network = assessNetwork(terrain, curve);
const plannedHour = network.outageHour ?? curve.peakHour();
const masks = siteViewsheds(terrain);
const { baseline, hole } = baselineTopUps(terrain, network, masks, plannedHour);
const evaluation = evaluateRoutes(graph, meta.depot.node, level, curve.levels, curve.peakHour());
const byId = new Map(meta.sites.map((s) => [s.id, s]));
const convoys = convoyOptions(terrain, network, masks, hole, plannedHour, baseline, { level, levels: curve.levels });
const survivors = new Set(network.liveAt(plannedHour));
const toppedUp = new Set(baseline.sites.map((s) => s.id));
const usable = new Set([...survivors, ...toppedUp, ...convoys.map((o) => o.site.id)]);
const allSites = assessSites(terrain, evaluation.distanceByNode, hole.mask, meta.sites);
const sites = allSites.filter((s) => s.backhaulOptions.some((o) => usable.has(o.siteId)));
const rec = recommendPlans(terrain, network, masks, hole, plannedHour, sites, convoys, baseline);

console.log(`gauge ${gauge.toFixed(1)} m · planned +${plannedHour} h · ${network.darkAt(plannedHour)} of ${network.summary.total} sites dark · hole before top-ups ${baseline.holeBefore} of ${hole.coveredNow} people · survivors: ${[...survivors].map((id) => byId.get(id)?.name).join(', ') || 'none'}`);
console.log('\nBASELINE TOP-UPS (local crews, before the access road closes)');
for (const s of baseline.sites) console.log(`${s.site.name.padEnd(24)} by +${s.accessCutHour} h`);
if (baseline.sites.length === 0) console.log('(none)');
console.log(`together keep ${baseline.peopleKept} (union) · residual hole ${hole.count}`);
console.log('\nCONVOY OPTIONS (one genset trailer from the depot, over roads open at arrival)');
console.log('site                     by      route   drive  people kept');
for (const o of convoys) console.log(`${o.site.site.name.padEnd(24)} +${String(o.by).padStart(2)} h  ${(o.routeKm + ' km').padStart(7)}  ${(o.travelHours + ' h').padStart(6)}  ${String(o.peopleKept).padStart(6)}`);
if (convoys.length === 0) console.log('(none)');
console.log(`\nPORTABLE TOWER CANDIDATES with a microwave path to a survivor, a topped-up site or a convoy site (${sites.length} of ${allSites.length} reachable)`);
console.log('candidate                route km   in hole   links (nearest first)');
for (const s of sites) console.log(`${s.candidate.name.padEnd(24)} ${s.routeKm.toFixed(1).padStart(7)}   ${String(s.peopleReconnected).padStart(7)}   ${s.backhaulOptions.filter((o) => usable.has(o.siteId)).slice(0, 3).map((o) => `${byId.get(o.siteId)?.name} ${o.km} km${survivors.has(o.siteId) ? ' (live)' : toppedUp.has(o.siteId) ? ' (top-up)' : ''}`).join(' · ')}`);
const describe = (p) => {
  const parts = [];
  if (p.convoy) parts.push(`convoy to ${p.convoy.site.site.name} by +${p.convoy.by} h (keeps ${p.convoy.peopleKept})`);
  if (p.portable) parts.push(`portable tower at ${p.portable.site.candidate.name} → ${byId.get(p.portable.backhaulTo)?.name} ${p.portable.backhaulKm} km (reconnects ${p.portable.peopleReconnected})`);
  return `${String(p.peopleOnSignal).padStart(5)} on signal · ${parts.join(' + ')}`;
};
console.log('\nPLANS (scarce moves over the residual hole)');
if (rec.best) console.log('BEST        ', describe(rec.best)); else console.log('BEST         no convoy or portable tower can reach the valley in time');
for (const p of rec.alternatives) console.log('ALTERNATIVE ', describe(p));
