/**
 * The Site stage's recommendation, in two tiers.
 *
 * Vocabulary, used the same way on the card and in the README: a "site" is
 * one of the existing masts in terrain.json; the "portable tower" is the
 * cell-on-wheels driven out from the depot; the "convoy" is the one genset
 * trailer from the depot; a "top-up" is a crew refuelling a site's generator.
 *
 * Tier 1, the baseline: every site a local crew can still reach with diesel
 * before its access road closes is assumed topped up. That is routine work
 * done everywhere at once, so it is never ranked against anything; it just
 * shrinks the hole. Tier 2, the scarce moves: where the one convoy goes and
 * where the one portable tower goes, ranked over the residual hole by people
 * on signal at the planned hour. Every count is people (WorldPop).
 */

import type { CoverageHole, NetworkAssessment, NetworkSiteState } from './network.ts';
import { coverageAt, coverageHole } from './network.ts';
import { populatedCells } from './population.ts';
import { routeFrom } from './routing.ts';
import type { SiteAssessment } from './sites.ts';
import type { TerrainData } from './terrain-field.ts';
import type { ViewshedMask } from './viewshed.ts';

/** The convoy's speed on flood-day roads. Illustrative. */
export const CONVOY_KMH = 40;
/** Convoy options considered when building combined plans (strongest first). */
const PLAN_CONVOY_CANDIDATES = 6;

/** Tier 1: sites local crews top up before their access closes. */
export type Baseline = {
  sites: NetworkSiteState[];
  /** Earliest access-cut hour among them: every top-up must be done by then. */
  by: number | null;
  /** People in the hole the union of their coverage keeps on signal. */
  peopleKept: number;
  /** People in the hole before the top-ups. */
  holeBefore: number;
};

/** Tier 2: the one genset trailer from the depot. */
export type ConvoyOption = {
  kind: 'convoy';
  site: NetworkSiteState;
  /** Latest arrival hour at which the roads on the way are still open. */
  by: number;
  routeKm: number;
  travelHours: number;
  /** People in the residual hole this site alone would keep on signal. */
  peopleKept: number;
};

export type PortableStep = {
  kind: 'portable';
  site: SiteAssessment;
  /** The live site the mast links to in this plan. */
  backhaulTo: string;
  backhaulKm: number;
  /** People without signal in this plan that the mast would reconnect. */
  peopleReconnected: number;
};

export type Plan = {
  convoy: ConvoyOption | null;
  portable: PortableStep | null;
  /** People kept or brought back on signal at the planned hour, beyond the baseline. */
  peopleOnSignal: number;
};

export type Recommendation = {
  /** Null when no convoy arrives in time and no candidate has a link. */
  best: Plan | null;
  alternatives: Plan[];
  baseline: Baseline;
  convoys: ConvoyOption[];
};

export type RoutingContext = {
  /** Observed level now — the level the convoy drives at. */
  level: number;
  /** Forecast levels per hour, for road closing hours. */
  levels: number[];
};

/** A site the plan loses to power that a local crew can still reach before its access closes. */
function canTopUp(state: NetworkSiteState, plannedHour: number) {
  return (
    state.failureCause === 'power' &&
    state.failureHour !== null &&
    state.failureHour <= plannedHour &&
    state.accessCutHour !== null &&
    state.accessCutHour > 0
  );
}

/**
 * Tier 1. The baseline top-ups and the residual hole they leave. A topped-up
 * site stays live through the planned hour; sites hanging off it by backhaul
 * are not revived (a stated simplification).
 */
export function baselineTopUps(
  terrain: TerrainData,
  network: NetworkAssessment,
  masks: Map<string, ViewshedMask>,
  plannedHour: number,
): { baseline: Baseline; hole: CoverageHole } {
  const before = coverageHole(terrain, masks, network, plannedHour);
  const sites = network.sites.filter((state) => canTopUp(state, plannedHour));
  const hole = coverageHole(
    terrain,
    masks,
    network,
    plannedHour,
    sites.map((state) => state.id),
  );
  const by = sites.length > 0 ? Math.min(...sites.map((state) => state.accessCutHour!)) : null;
  return {
    baseline: { sites, by, peopleKept: before.count - hole.count, holeBefore: before.count },
    hole,
  };
}

/**
 * Tier 2a. Convoy options: sites the plan loses to power that no local crew
 * can reach, but the convoy can. A convoy must drive on roads that are still
 * open when it passes, so it is routed over the roads open at its arrival
 * hour rather than the shortest path now — a shortcut that floods within the
 * hour is no shortcut. The latest arrival hour with the drive time inside
 * that window is the "by".
 */
export function convoyOptions(
  terrain: TerrainData,
  network: NetworkAssessment,
  masks: Map<string, ViewshedMask>,
  hole: CoverageHole,
  plannedHour: number,
  baseline: Baseline,
  routing: RoutingContext,
): ConvoyOption[] {
  const { graph, meta } = terrain;
  const cells = populatedCells(terrain);
  const toppedUp = new Set(baseline.sites.map((state) => state.id));
  const routeAtHour: Map<number, number>[] = [];
  for (let h = 0; h < routing.levels.length; h += 1) {
    routeAtHour.push(routeFrom(graph.edges, meta.depot.node, routing.levels[h]!).distance);
  }
  const convoyWindow = (node: number) => {
    for (let h = routing.levels.length - 1; h >= 1; h -= 1) {
      const km = routeAtHour[h]!.get(node);
      if (km === undefined) continue;
      if (km / CONVOY_KMH <= h) return { by: h, km };
    }
    return null;
  };
  const peopleKeptBy = (id: string) => {
    const mask = masks.get(id);
    if (!mask) return 0;
    let kept = 0;
    for (let i = 0; i < cells.count; i += 1) {
      if (hole.mask[i] && mask.covers(cells.lon[i]!, cells.lat[i]!)) kept += cells.people[i]!;
    }
    return Math.round(kept);
  };

  const options: ConvoyOption[] = [];
  for (const state of network.sites) {
    if (state.failureCause !== 'power' || state.failureHour === null) continue;
    if (state.failureHour > plannedHour || toppedUp.has(state.id)) continue;
    const window = convoyWindow(state.site.accessNode);
    if (!window) continue; // no road stays open long enough for the drive
    // A generator on site with fuel for days keeps it up through the horizon.
    options.push({
      kind: 'convoy',
      site: state,
      by: window.by,
      routeKm: Number(window.km.toFixed(1)),
      travelHours: Number((window.km / CONVOY_KMH).toFixed(1)),
      peopleKept: peopleKeptBy(state.id),
    });
  }
  options.sort((a, b) => b.peopleKept - a.peopleKept || a.by - b.by);
  return options;
}

/**
 * Tier 2b. Builds and ranks the scarce moves over the residual hole: portable
 * tower only, convoy only, and convoy + portable tower with the mast linked
 * to the convoy's site. The hole shrinks by the convoy site's coverage, so
 * the tower's value in a combined plan is what it adds beyond that.
 */
export function recommendPlans(
  terrain: TerrainData,
  network: NetworkAssessment,
  masks: Map<string, ViewshedMask>,
  hole: CoverageHole,
  plannedHour: number,
  sites: SiteAssessment[],
  convoys: ConvoyOption[],
  baseline: Baseline,
): Recommendation {
  const cells = populatedCells(terrain);
  // Live in every plan: survivors and the topped-up sites.
  const liveIds = new Set([...network.liveAt(plannedHour), ...baseline.sites.map((s) => s.id)]);

  const holeMaskGiven = (extraLive: string | null) => {
    if (!extraLive) return hole.mask;
    const extra = coverageAt(masks, [extraLive]);
    const mask = new Uint8Array(hole.mask);
    for (let i = 0; i < cells.count; i += 1) {
      if (mask[i] && extra.covers(cells.lon[i]!, cells.lat[i]!)) mask[i] = 0;
    }
    return mask;
  };
  const reconnectedIn = (site: SiteAssessment, mask: Uint8Array) => {
    let n = 0;
    for (let i = 0; i < cells.count; i += 1) {
      if (mask[i] && site.mask.covers(cells.lon[i]!, cells.lat[i]!)) n += cells.people[i]!;
    }
    return Math.round(n);
  };
  const bestTower = (live: Set<string>, mask: Uint8Array): PortableStep | null => {
    let best: PortableStep | null = null;
    for (const site of sites) {
      const link = site.backhaulOptions.find((o) => live.has(o.siteId));
      if (!link) continue;
      const peopleReconnected = reconnectedIn(site, mask);
      if (
        !best ||
        peopleReconnected > best.peopleReconnected ||
        (peopleReconnected === best.peopleReconnected && site.routeKm < best.site.routeKm)
      ) {
        best = { kind: 'portable', site, backhaulTo: link.siteId, backhaulKm: link.km, peopleReconnected };
      }
    }
    return best;
  };

  const plans: Plan[] = [];
  const towerOnly = bestTower(liveIds, hole.mask);
  if (towerOnly && towerOnly.peopleReconnected > 0) {
    plans.push({ convoy: null, portable: towerOnly, peopleOnSignal: towerOnly.peopleReconnected });
  }
  for (const convoy of convoys.slice(0, PLAN_CONVOY_CANDIDATES)) {
    plans.push({ convoy, portable: null, peopleOnSignal: convoy.peopleKept });
    const live = new Set(liveIds);
    live.add(convoy.site.id);
    const tower = bestTower(live, holeMaskGiven(convoy.site.id));
    if (tower && tower.peopleReconnected > 0) {
      plans.push({ convoy, portable: tower, peopleOnSignal: convoy.peopleKept + tower.peopleReconnected });
    }
  }
  const moves = (p: Plan) => (p.convoy ? 1 : 0) + (p.portable ? 1 : 0);
  plans.sort(
    (a, b) =>
      b.peopleOnSignal - a.peopleOnSignal ||
      moves(a) - moves(b) ||
      (a.portable?.site.routeKm ?? 0) - (b.portable?.site.routeKm ?? 0),
  );
  const best = plans[0] ?? null;
  // Alternatives: the next-best plans of a different shape, at most two.
  const alternatives: Plan[] = [];
  const shape = (p: Plan) => `${p.convoy?.site.id ?? '-'}|${p.portable?.site.id ?? '-'}`;
  for (const plan of plans.slice(1)) {
    if (alternatives.length >= 2) break;
    if (best && shape(plan) === shape(best)) continue;
    if (alternatives.some((a) => shape(a) === shape(plan))) continue;
    alternatives.push(plan);
  }
  return { best, alternatives, baseline, convoys };
}
