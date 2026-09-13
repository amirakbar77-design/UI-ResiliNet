/**
 * Routes the tower truck from the depot to every candidate over the baked
 * road graph at a few flood levels, so reachability can be sanity-checked
 * without the UI. Uses the same cut rule as the renderer (lib/routing.ts).
 *
 *   node scripts/check-routes.mjs [level ...]   (metres; default 2 6 10)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { edgeCutAt, routeFrom } from '../lib/routing.ts';

const terrain = JSON.parse(
  await readFile(path.resolve('public/terrain/terrain.json'), 'utf8'),
);
const graph = JSON.parse(
  await readFile(path.resolve('public/terrain', terrain.roads.file), 'utf8'),
);

const levels = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (levels.length === 0) levels.push(2, 6, 10);

console.log(
  `depot ${terrain.depot.name} (node ${terrain.depot.node}) · ${graph.nodes.length} nodes, ${graph.edges.length} edges · ${terrain.candidates.length} candidates`,
);
const results = new Map(levels.map((level) => [level, routeFrom(graph.edges, terrain.depot.node, level)]));
console.log(['#', 'candidate'.padEnd(24), 'elev', 'road m', ...levels.map((l) => `@${l} m`.padStart(9))].join('  '));
for (const [index, candidate] of terrain.candidates.entries()) {
  const cells = levels.map((level) => {
    const km = results.get(level).distance.get(candidate.roadNode);
    return (km === undefined ? 'blocked' : `${km.toFixed(1)} km`).padStart(9);
  });
  console.log(
    [
      String(index + 1).padStart(2),
      candidate.name.slice(0, 24).padEnd(24),
      String(candidate.elevation).padStart(4),
      String(candidate.nearestRoadM).padStart(6),
      ...cells,
    ].join('  '),
  );
}
for (const level of levels) {
  const { distance } = results.get(level);
  const reachable = terrain.candidates.filter((c) => distance.has(c.roadNode)).length;
  const roads = graph.edges.filter((e) => e.klass !== 'rail');
  const openKm = roads.filter((e) => !edgeCutAt(e, level) && distance.has(e.a) && distance.has(e.b)).reduce((s, e) => s + e.km, 0);
  const cutKm = roads.filter((e) => edgeCutAt(e, level)).reduce((s, e) => s + e.km, 0);
  console.log(`@${level} m: ${reachable}/${terrain.candidates.length} candidates reachable · ${openKm.toFixed(0)} km reachable from the depot · ${cutKm.toFixed(0)} km cut`);
}
