/**
 * Site evaluation for the portable tower: which candidates the truck can
 * reach now, and how many homes without signal each would reconnect at the
 * planned hour. "Without signal" comes from lib/network.ts: homes covered by
 * a live site now that no live site covers at the planned hour.
 */

import type { Candidate, TerrainData } from './terrain-field.ts';
import { viewshedMask, type ViewshedMask } from './viewshed.ts';

export type SiteAssessment = {
  /** Matches the scene's candidate marker id. */
  id: string;
  index: number;
  candidate: Candidate;
  /** Route kilometres from the depot to the candidate's road node, now. */
  routeKm: number;
  /** Homes without signal at the planned hour that the mast would see. */
  homesReconnected: number;
  /** All homes the mast would see, flooded or not. */
  homesCovered: number;
  mask: ViewshedMask;
};

/**
 * Assesses every candidate the route wave reaches, in order of route
 * distance, counting the homes in the coverage hole (`hole[i] === 1`) that
 * fall inside the mast's line-of-sight viewshed. Deterministic.
 */
export function assessSites(
  terrain: TerrainData,
  distanceByNode: Map<number, number>,
  hole: Uint8Array,
  mastMetres = 32,
  radiusMetres = 9000,
): SiteAssessment[] {
  const { houses } = terrain;
  const count = houses.length / 3;

  const results: SiteAssessment[] = [];
  terrain.meta.candidates.forEach((candidate, index) => {
    const routeKm = distanceByNode.get(candidate.roadNode);
    if (routeKm === undefined) return;
    const mask = viewshedMask(terrain, candidate, mastMetres, radiusMetres);
    let homesReconnected = 0;
    let homesCovered = 0;
    for (let i = 0; i < count; i += 1) {
      if (!mask.covers(houses[i * 3]!, houses[i * 3 + 1]!)) continue;
      homesCovered += 1;
      if (hole[i]) homesReconnected += 1;
    }
    results.push({
      id: `candidate-${index}`,
      index,
      candidate,
      routeKm,
      homesReconnected,
      homesCovered,
      mask,
    });
  });
  results.sort((a, b) => a.routeKm - b.routeKm || a.index - b.index);
  return results;
}
