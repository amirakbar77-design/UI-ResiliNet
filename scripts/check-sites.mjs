/**
 * Prints the keep-alive options, the portable candidates with their microwave
 * links, and the ranked plans for a gauge reading:
 *
 *   node scripts/check-sites.mjs [gaugeMetres]   (default 27.0)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { floodCurve } from '../lib/forecast.ts';
import { assessNetwork, coverageHole, siteViewsheds } from '../lib/network.ts';
import { keepAliveOptions, recommendPlans } from '../lib/recommend.ts';
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
const hole = coverageHole(terrain, masks, network, plannedHour);
const evaluation = evaluateRoutes(graph, meta.depot.node, level, curve.levels, curve.peakHour());
const byId = new Map(meta.sites.map((s) => [s.id, s]));
const keep = keepAliveOptions(terrain, network, masks, hole, plannedHour, { level, levels: curve.levels });
const survivors = new Set(network.liveAt(plannedHour));
const usable = new Set([...survivors, ...keep.map((o) => o.site.id)]);
const allSites = assessSites(terrain, evaluation.distanceByNode, hole.mask, meta.sites);
const sites = allSites.filter((s) => s.backhaulOptions.some((o) => usable.has(o.siteId)));
const rec = recommendPlans(terrain, network, masks, hole, plannedHour, sites, keep);

console.log(`gauge ${gauge.toFixed(1)} m · planned +${plannedHour} h · ${network.darkAt(plannedHour)} of ${network.summary.total} sites dark · hole ${hole.count} of ${hole.coveredNow} people · survivors: ${[...survivors].map((id) => byId.get(id)?.name).join(', ') || 'none'}`);
console.log('\nKEEP-ALIVE');
console.log('site                     method          by      route   drive  people kept');
for (const o of keep) console.log(`${o.site.site.name.padEnd(24)} ${o.method.padEnd(15)} +${String(o.by).padStart(2)} h  ${(o.routeKm === null ? '—' : o.routeKm + ' km').padStart(7)}  ${(o.travelHours === null ? '—' : o.travelHours + ' h').padStart(6)}  ${String(o.peopleKept).padStart(6)}`);
if (keep.length === 0) console.log('(none)');
console.log(`\nPORTABLE CANDIDATES with a microwave path to a survivor or a keepable site (${sites.length} of ${allSites.length} reachable)`);
console.log('candidate                route km   in hole   links (nearest first)');
for (const s of sites) console.log(`${s.candidate.name.padEnd(24)} ${s.routeKm.toFixed(1).padStart(7)}   ${String(s.peopleReconnected).padStart(7)}   ${s.backhaulOptions.filter((o) => usable.has(o.siteId)).slice(0, 3).map((o) => `${byId.get(o.siteId)?.name} ${o.km} km${survivors.has(o.siteId) ? ' (live)' : ''}`).join(' · ')}`);
const describe = (p) => {
  const parts = [];
  if (p.keep) parts.push(`${p.keep.method === 'generator-run' ? 'generator run to' : 'local refuel of'} ${p.keep.site.site.name} by +${p.keep.by} h (keeps ${p.keep.peopleKept})`);
  if (p.portable) parts.push(`tower at ${p.portable.site.candidate.name} → ${byId.get(p.portable.backhaulTo)?.name} ${p.portable.backhaulKm} km (reconnects ${p.portable.peopleReconnected})`);
  return `${String(p.peopleOnSignal).padStart(5)} on signal · ${parts.join(' + ')}`;
};
console.log('\nPLANS');
if (rec.best) console.log('BEST        ', describe(rec.best)); else console.log('BEST         nothing viable');
for (const p of rec.alternatives) console.log('ALTERNATIVE ', describe(p));
