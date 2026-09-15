/**
 * Site evaluation for the portable tower: which candidates the truck can
 * reach now, and how many people without signal each would reconnect at the
 * planned hour. "Without signal" comes from lib/network.ts: people covered by
 * a live site now that no live site covers at the planned hour.
 */

import { populatedCells } from './population.ts';
import type { Candidate, Site, TerrainData } from './terrain-field.ts';
import { elevationAtLonLat, viewshedMask, type ViewshedMask } from './viewshed.ts';

/** Microwave backhaul reach from a portable mast to an existing site. Illustrative; real: link budget per radio. */
export const BACKHAUL_RANGE_METRES = 15_000;

/** An existing site the portable mast could link to by microwave, nearest first. */
export type BackhaulOption = { siteId: string; km: number };
/** Clearance the backhaul ray must keep above the ground between the two masts. */
const BACKHAUL_CLEARANCE_METRES = 5;

export type SiteAssessment = {
  /** Matches the scene's candidate marker id. */
  id: string;
  index: number;
  candidate: Candidate;
  /** Route kilometres from the depot to the candidate's road node, now. */
  routeKm: number;
  /** People without signal at the planned hour that the mast would see. */
  peopleReconnected: number;
  /** Everyone the mast would see. */
  peopleCovered: number;
  mask: ViewshedMask;
  /** Every existing site in microwave view, nearest first; the plan picks one that is live. */
  backhaulOptions: BackhaulOption[];
  /** The link the current plan uses (nearest option by default). */
  backhaulTo: string;
  backhaulKm: number;
};

/**
 * Assesses every candidate the route wave reaches, in order of route
 * distance, counting the people in the coverage hole (`hole[i] === 1` per
 * populated cell) that fall inside the mast's line-of-sight viewshed.
 * Deterministic.
 */
export function assessSites(
  terrain: TerrainData,
  distanceByNode: Map<number, number>,
  hole: Uint8Array,
  /** Existing sites a mast could link to — live now or keepable; the plan decides which count. */
  linkableSites: Site[],
  mastMetres = 32,
  radiusMetres = 9000,
): SiteAssessment[] {
  const cells = populatedCells(terrain);
  const metresBetween = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) =>
    Math.hypot(
      (a.lon - b.lon) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)),
      (a.lat - b.lat) * 110_574,
    );
  // Mast-to-mast line of sight over the DEM with a little clearance, to every
  // linkable site in range, nearest first.
  const backhaulFor = (candidate: Candidate): BackhaulOption[] => {
    const eye = elevationAtLonLat(terrain, candidate.lon, candidate.lat) + mastMetres;
    const inRange = linkableSites
      .map((site) => ({ site, km: metresBetween(candidate, site) / 1000 }))
      .filter((entry) => entry.km * 1000 <= BACKHAUL_RANGE_METRES)
      .sort((a, b) => a.km - b.km);
    const options: BackhaulOption[] = [];
    for (const { site, km } of inRange) {
      const target = elevationAtLonLat(terrain, site.lon, site.lat) + site.mastMetres;
      const steps = Math.max(2, Math.ceil((km * 1000) / 30));
      let clear = true;
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps;
        const ground = elevationAtLonLat(
          terrain,
          candidate.lon + (site.lon - candidate.lon) * t,
          candidate.lat + (site.lat - candidate.lat) * t,
        );
        if (ground > eye + (target - eye) * t - BACKHAUL_CLEARANCE_METRES) {
          clear = false;
          break;
        }
      }
      if (clear) options.push({ siteId: site.id, km: Number(km.toFixed(1)) });
    }
    return options;
  };

  const results: SiteAssessment[] = [];
  terrain.meta.candidates.forEach((candidate, index) => {
    const routeKm = distanceByNode.get(candidate.roadNode);
    if (routeKm === undefined) return;
    // A mast with nothing to link to is a lamp post.
    const backhaulOptions = backhaulFor(candidate);
    if (backhaulOptions.length === 0) return;
    const mask = viewshedMask(terrain, candidate, mastMetres, radiusMetres);
    let peopleReconnected = 0;
    let peopleCovered = 0;
    for (let i = 0; i < cells.count; i += 1) {
      if (!mask.covers(cells.lon[i]!, cells.lat[i]!)) continue;
      peopleCovered += cells.people[i]!;
      if (hole[i]) peopleReconnected += cells.people[i]!;
    }
    results.push({
      id: `candidate-${index}`,
      index,
      candidate,
      routeKm,
      peopleReconnected: Math.round(peopleReconnected),
      peopleCovered: Math.round(peopleCovered),
      mask,
      backhaulOptions,
      backhaulTo: backhaulOptions[0]!.siteId,
      backhaulKm: backhaulOptions[0]!.km,
    });
  });
  results.sort((a, b) => a.routeKm - b.routeKm || a.index - b.index);
  return results;
}
