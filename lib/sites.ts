/**
 * Site evaluation for the portable tower: which candidates the truck can
 * reach now, and how many homes each would reconnect at the planned hour.
 */

import { HAND_DRY_DM } from './routing';
import type { Candidate, TerrainData } from './terrain-field';
import { handAtLonLat, viewshedMask, type ViewshedMask } from './viewshed';

export type SiteAssessment = {
  /** Matches the scene's candidate marker id. */
  id: string;
  index: number;
  candidate: Candidate;
  /** Route kilometres from the depot to the candidate's road node, now. */
  routeKm: number;
  /** Homes flooded at the planned hour that the mast would see. */
  homesReconnected: number;
  /** All homes the mast would see, flooded or not. */
  homesCovered: number;
  mask: ViewshedMask;
};

/**
 * Assesses every candidate the route wave reaches, in order of route
 * distance, counting the homes that are under water at `plannedLevel` and
 * inside the mast's line-of-sight viewshed. Deterministic.
 */
export function assessSites(
  terrain: TerrainData,
  distanceByNode: Map<number, number>,
  plannedLevel: number,
  mastMetres = 32,
  radiusMetres = 9000,
): SiteAssessment[] {
  const { houses } = terrain;
  const count = houses.length / 3;
  const flooded = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    const hand = handAtLonLat(terrain, houses[i * 3]!, houses[i * 3 + 1]!);
    if (hand !== HAND_DRY_DM && hand / 10 < plannedLevel) flooded[i] = 1;
  }

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
      if (flooded[i]) homesReconnected += 1;
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
