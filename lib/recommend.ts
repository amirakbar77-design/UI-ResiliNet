/**
 * The Site stage's recommendation as a plan: keep an existing site alive,
 * deploy the portable tower, or both — the tower linked by microwave to a
 * site that is live in that plan. Whichever keeps the most homes on signal
 * at the planned hour wins. A system that can say "refuel, don't deploy" is
 * the one an operator believes. Every count is people (WorldPop).
 */

import type { CoverageHole, NetworkAssessment, NetworkSiteState } from './network.ts';
import { coverageAt } from './network.ts';
import { populatedCells } from './population.ts';
import { routeFrom } from './routing.ts';
import type { SiteAssessment } from './sites.ts';
import type { TerrainData } from './terrain-field.ts';
import type { ViewshedMask } from './viewshed.ts';

/** A generator-and-fuel convoy's speed on flood-day roads. Illustrative. */
export const CONVOY_KMH = 40;
/** Keep-alive options considered when building combined plans (strongest first). */
const PLAN_KEEP_CANDIDATES = 6;

export type KeepAliveOption = {
  kind: 'keep-alive';
  site: NetworkSiteState;
  /** local-refuel: a crew from a nearby station; generator-run: a convoy from the depot. */
  method: 'local-refuel' | 'generator-run';
  /** Latest hour the fuel can still get there — the road closes after this. */
  by: number;
  /** Road km and drive time for a generator run; null for a local refuel. */
  routeKm: number | null;
  travelHours: number | null;
  /** People in the hole that this site alone would keep on signal. */
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
  keep: KeepAliveOption | null;
  portable: PortableStep | null;
  /** People kept or brought back on signal at the planned hour. */
  peopleOnSignal: number;
};

export type Recommendation = {
  best: Plan | null;
  alternatives: Plan[];
  keepAlive: KeepAliveOption[];
};

export type RoutingContext = {
  /** Observed level now — the level the convoy drives at. */
  level: number;
  /** Forecast levels per hour, for road closing hours. */
  levels: number[];
};

/**
 * Keep-alive options: sites the plan loses to power. Two ways to keep one:
 * a local crew refuels it while a station is still within range (the model's
 * access rule), or a generator run from the depot reaches it before the
 * first road on the way closes.
 */
export function keepAliveOptions(
  terrain: TerrainData,
  network: NetworkAssessment,
  masks: Map<string, ViewshedMask>,
  hole: CoverageHole,
  plannedHour: number,
  routing: RoutingContext,
): KeepAliveOption[] {
  const { graph, meta } = terrain;
  const cells = populatedCells(terrain);
  const survivors = coverageAt(masks, network.liveAt(plannedHour));
  // A convoy must drive on roads that are still open when it passes, so it is
  // routed over the roads open at its arrival hour rather than the shortest
  // path now — a shortcut that floods within the hour is no shortcut. For each
  // site, the latest arrival hour at which it is still reachable with the
  // drive time inside that window is the "by".
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
      if (!hole.mask[i]) continue;
      const lon = cells.lon[i]!;
      const lat = cells.lat[i]!;
      if (mask.covers(lon, lat) && !survivors.covers(lon, lat)) kept += cells.people[i]!;
    }
    return Math.round(kept);
  };

  const options: KeepAliveOption[] = [];
  for (const state of network.sites) {
    if (state.failureCause !== 'power' || state.failureHour === null) continue;
    if (state.failureHour > plannedHour) continue;
    const peopleKept = peopleKeptBy(state.id);
    if (state.accessCutHour !== null && state.accessCutHour > 0) {
      options.push({ kind: 'keep-alive', site: state, method: 'local-refuel', by: state.accessCutHour, routeKm: null, travelHours: null, peopleKept });
      continue;
    }
    const window = convoyWindow(state.site.accessNode);
    if (!window) continue; // no road stays open long enough for the drive
    // A generator on site with fuel for days keeps it up through the horizon.
    options.push({
      kind: 'keep-alive',
      site: state,
      method: 'generator-run',
      by: window.by,
      routeKm: Number(window.km.toFixed(1)),
      travelHours: Number((window.km / CONVOY_KMH).toFixed(1)),
      peopleKept,
    });
  }
  options.sort((a, b) => b.peopleKept - a.peopleKept || a.by - b.by);
  return options;
}

/**
 * Builds and ranks plans: tower only, refuel only, and refuel + tower with the
 * tower linked to the kept site. The hole shrinks by the kept site's coverage,
 * so the tower's value in a combined plan is what it adds beyond that.
 */
export function recommendPlans(
  terrain: TerrainData,
  network: NetworkAssessment,
  masks: Map<string, ViewshedMask>,
  hole: CoverageHole,
  plannedHour: number,
  sites: SiteAssessment[],
  keepAlive: KeepAliveOption[],
): Recommendation {
  const cells = populatedCells(terrain);
  const survivorIds = new Set(network.liveAt(plannedHour));

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
  const bestTower = (liveIds: Set<string>, mask: Uint8Array): PortableStep | null => {
    let best: PortableStep | null = null;
    for (const site of sites) {
      const link = site.backhaulOptions.find((o) => liveIds.has(o.siteId));
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
  const towerOnly = bestTower(survivorIds, hole.mask);
  if (towerOnly) plans.push({ keep: null, portable: towerOnly, peopleOnSignal: towerOnly.peopleReconnected });
  for (const keep of keepAlive.slice(0, PLAN_KEEP_CANDIDATES)) {
    plans.push({ keep, portable: null, peopleOnSignal: keep.peopleKept });
    const liveIds = new Set(survivorIds);
    liveIds.add(keep.site.id);
    const mask = holeMaskGiven(keep.site.id);
    const tower = bestTower(liveIds, mask);
    if (tower && tower.peopleReconnected > 0) {
      plans.push({ keep, portable: tower, peopleOnSignal: keep.peopleKept + tower.peopleReconnected });
    }
  }
  const steps = (p: Plan) => (p.keep ? 1 : 0) + (p.portable ? 1 : 0);
  plans.sort(
    (a, b) =>
      b.peopleOnSignal - a.peopleOnSignal ||
      steps(a) - steps(b) ||
      (a.portable?.site.routeKm ?? 0) - (b.portable?.site.routeKm ?? 0),
  );
  const best = plans[0] ?? null;
  // Alternatives: the next-best plans of a different shape, at most two.
  const alternatives: Plan[] = [];
  for (const plan of plans.slice(1)) {
    if (alternatives.length >= 2) break;
    const shape = (p: Plan) => `${p.keep?.site.id ?? '-'}|${p.portable?.site.id ?? '-'}`;
    if (best && shape(plan) === shape(best)) continue;
    if (alternatives.some((a) => shape(a) === shape(plan))) continue;
    alternatives.push(plan);
  }
  return { best, alternatives, keepAlive };
}
