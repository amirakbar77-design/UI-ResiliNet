/**
 * Existing-network failure model. For every baked site: is it up, on battery
 * or down right now, and when — and why — does the forecast take it down.
 *
 * Three mechanisms, each an illustrative stand-in for what an operator's NOC
 * would know per site:
 *   inundation — the cabinet goes under when the river passes the site's HAND;
 *   power      — grid fails with the flood; the site runs on battery until the
 *                access road is cut and nobody can refuel; genset sites get one
 *                refuelling's worth of extra hours;
 *   backhaul   — a site dies when its backhaul parent dies (fibre along a cut
 *                road, or a dark microwave hop).
 *
 * Runtime imports use .ts extensions so scripts/check-network.mjs can load
 * this module straight into Node.
 */

import type { FloodCurve } from './forecast.ts';
import { edgeCutAt } from './routing.ts';
import type { Site, TerrainData } from './terrain-field.ts';
import { viewshedMask, type ViewshedMask } from './viewshed.ts';

// --- Constants (illustrative) ------------------------------------------------
/** Hours a site runs on battery after the grid drops (rural macro sites carry 4–8 h). Real: per-site runway from the operator's NOC. */
export const BATTERY_HOURS = 8;
/** Extra hours a genset buys — one tank, one refuelling before the road closes. Real: tank size and refuelling contract. */
export const GENSET_HOURS = 12;
/**
 * Refuelling is local, not from the depot: a crew fetches diesel from the
 * nearest town or petrol station (terrain.json fuelSources) and a site stays
 * refuellable while one of those is within FUEL_RUN_KM of its access node by
 * roads that are not cut. Real: the operator's fuel contracts and crew bases.
 */
export const FUEL_RUN_KM = 25;

export type SiteStatus = 'up' | 'battery' | 'down';
export type FailureCause = 'inundation' | 'power' | 'backhaul' | 'manual';

export type NetworkSiteState = {
  id: string;
  site: Site;
  /** Status right now (hour 0), after any officer override. */
  status: SiteStatus;
  /** Forecast hour the site goes dark, or null if it survives the horizon. */
  failureHour: number | null;
  failureCause: FailureCause | null;
  /** Hour the access road is cut (unreachable from the depot), or null. */
  accessCutHour: number | null;
  /** Hour the cabinet floods, or null. */
  inundationHour: number | null;
  /** True when the officer has forced the status. */
  manual: boolean;
};

export type NetworkAssessment = {
  sites: NetworkSiteState[];
  /** Number of sites dark at a (fractional) forecast hour. */
  darkAt: (hour: number) => number;
  /** Ids of sites still up (or on battery) at a forecast hour. */
  liveAt: (hour: number) => string[];
  /**
   * The hour the network is at its worst within the horizon — the last
   * failure, since nothing recovers in the model — or null if nothing fails.
   * Sites starve hours after the roads close, so this is usually later than
   * the river peak; it is the hour a portable tower should be planned for.
   */
  outageHour: number | null;
  summary: { total: number; up: number; battery: number; down: number };
};

export type Overrides = Record<string, SiteStatus | undefined>;

/**
 * Assesses every site against the river curve. `overrides` win over the
 * model: 'down' means dark now; 'battery' means on battery now (dies after
 * BATTERY_HOURS unless the model says sooner); 'up' means the officer has
 * confirmed it, so only failures the model puts in the future still apply.
 */
export function assessNetwork(
  terrain: TerrainData,
  curve: FloodCurve,
  overrides: Overrides = {},
): NetworkAssessment {
  const { meta, graph } = terrain;
  const hours = curve.levels.length;

  // Refuelling access per hour: a multi-source Dijkstra from every fuel
  // source over the roads that are not cut, capped at FUEL_RUN_KM, gives the
  // set of sites a crew can still reach with diesel.
  const sources = meta.fuelSources.map((s) => s.node);
  const refuellableByHour: Set<string>[] = [];
  for (let h = 0; h < hours; h += 1) {
    const level = curve.levels[h]!;
    const adjacency = new Map<number, { to: number; km: number }[]>();
    for (const edge of graph.edges) {
      if (edge.klass === 'rail' || edgeCutAt(edge, level)) continue;
      for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
        let list = adjacency.get(from);
        if (!list) {
          list = [];
          adjacency.set(from, list);
        }
        list.push({ to, km: edge.km });
      }
    }
    const distance = new Map<number, number>();
    const open: { node: number; km: number }[] = [];
    for (const node of sources) {
      distance.set(node, 0);
      open.push({ node, km: 0 });
    }
    while (open.length > 0) {
      open.sort((x, y) => x.km - y.km);
      const { node, km } = open.shift()!;
      if (km > (distance.get(node) ?? Infinity)) continue;
      for (const next of adjacency.get(node) ?? []) {
        const total = km + next.km;
        if (total > FUEL_RUN_KM) continue;
        if (total < (distance.get(next.to) ?? Infinity)) {
          distance.set(next.to, total);
          open.push({ node: next.to, km: total });
        }
      }
    }
    const refuellable = new Set<string>();
    for (const site of meta.sites) {
      if (distance.has(site.accessNode)) refuellable.add(site.id);
    }
    refuellableByHour.push(refuellable);
  }
  const accessCutHour = (site: Site) => {
    for (let h = 0; h < hours; h += 1) {
      if (!refuellableByHour[h]!.has(site.id)) return h;
    }
    return null;
  };
  const inundationHour = (site: Site) => {
    const cabinet = site.handDm >= 255 ? Infinity : site.handDm / 10;
    for (let h = 0; h < hours; h += 1) {
      if (curve.levelAt(h) > cabinet) return h;
    }
    return null;
  };

  const byId = new Map(meta.sites.map((site) => [site.id, site]));
  const modelFailure = new Map<string, { hour: number | null; cause: FailureCause | null }>();
  const accessCut = new Map<string, number | null>();
  const flooded = new Map<string, number | null>();
  const visiting = new Set<string>();

  const failureOf = (id: string): { hour: number | null; cause: FailureCause | null } => {
    const cached = modelFailure.get(id);
    if (cached) return cached;
    const site = byId.get(id);
    if (!site) return { hour: null, cause: null };
    if (visiting.has(id)) return { hour: null, cause: null }; // backhaul cycle guard
    visiting.add(id);

    const wet = inundationHour(site);
    flooded.set(id, wet);
    const cut = accessCutHour(site);
    accessCut.set(id, cut);
    const runway = (site.power.batteryHours ?? BATTERY_HOURS) + (site.power.genset ? GENSET_HOURS : 0);
    const power = cut === null ? null : cut + runway;
    const parent = site.backhaul.parent ? failureOf(site.backhaul.parent) : { hour: null, cause: null };

    // Earliest wins; ties resolve in this order so the cause is deterministic.
    const candidates: Array<[number | null, FailureCause]> = [
      [wet, 'inundation'],
      [power, 'power'],
      [parent.hour, 'backhaul'],
    ];
    let best: { hour: number | null; cause: FailureCause | null } = { hour: null, cause: null };
    for (const [hour, cause] of candidates) {
      if (hour === null) continue;
      if (best.hour === null || hour < best.hour) best = { hour, cause };
    }
    // Beyond the forecast horizon counts as surviving it.
    if (best.hour !== null && best.hour >= hours) best = { hour: null, cause: null };
    visiting.delete(id);
    modelFailure.set(id, best);
    return best;
  };

  const sites: NetworkSiteState[] = meta.sites.map((site) => {
    const model = failureOf(site.id);
    const cut = accessCut.get(site.id) ?? null;
    const override = overrides[site.id];
    let status: SiteStatus =
      model.hour !== null && model.hour <= 0 ? 'down' : cut !== null && cut <= 0 ? 'battery' : 'up';
    let failureHour = model.hour;
    let failureCause = model.cause;
    if (override === 'down') {
      status = 'down';
      failureHour = 0;
      failureCause = 'manual';
    } else if (override === 'battery') {
      status = 'battery';
      const runway = site.power.batteryHours ?? BATTERY_HOURS;
      if (failureHour === null || failureHour > runway) {
        failureHour = runway;
        failureCause = 'manual';
      }
    } else if (override === 'up') {
      status = 'up';
      if (failureHour !== null && failureHour <= 0) {
        failureHour = null;
        failureCause = null;
      }
    }
    return {
      id: site.id,
      site,
      status,
      failureHour,
      failureCause,
      accessCutHour: cut,
      inundationHour: flooded.get(site.id) ?? null,
      manual: override !== undefined,
    };
  });

  const darkAt = (hour: number) =>
    sites.filter((s) => s.failureHour !== null && s.failureHour <= hour).length;
  const liveAt = (hour: number) =>
    sites.filter((s) => s.failureHour === null || s.failureHour > hour).map((s) => s.id);
  let outageHour: number | null = null;
  for (const s of sites) {
    if (s.failureHour !== null && (outageHour === null || s.failureHour > outageHour)) outageHour = s.failureHour;
  }
  const summary = {
    total: sites.length,
    up: sites.filter((s) => s.status === 'up').length,
    battery: sites.filter((s) => s.status === 'battery').length,
    down: sites.filter((s) => s.status === 'down').length,
  };
  return { sites, darkAt, liveAt, outageHour, summary };
}

// --- Coverage and the hole -------------------------------------------------

/** Macro-site coverage radius; one value for every site until real data says otherwise. */
export const SITE_COVERAGE_RADIUS_METRES = 9000;

/** Line-of-sight viewshed per existing site; sites do not move, so compute once. */
export function siteViewsheds(terrain: TerrainData, sites: Site[] = terrain.meta.sites) {
  const masks = new Map<string, ViewshedMask>();
  for (const site of sites) {
    masks.set(site.id, viewshedMask(terrain, site, site.mastMetres, SITE_COVERAGE_RADIUS_METRES));
  }
  return masks;
}

/** Union of the viewsheds of the sites in `liveIds`. */
export function coverageAt(masks: Map<string, ViewshedMask>, liveIds: string[]) {
  const live = liveIds.map((id) => masks.get(id)).filter((m): m is ViewshedMask => m !== undefined);
  return {
    covers: (lon: number, lat: number) => live.some((mask) => mask.covers(lon, lat)),
  };
}

export type CoverageHole = {
  /** 1 for each home that has signal now and none at the hour. */
  mask: Uint8Array;
  count: number;
  /** Homes with signal now, for context. */
  coveredNow: number;
};

/**
 * The hole at `hour`: homes covered by a live site right now that no site
 * still live at `hour` covers. Flooding alone does not put a home here — a
 * flooded home under a working site still has signal.
 */
export function coverageHole(
  terrain: TerrainData,
  masks: Map<string, ViewshedMask>,
  network: NetworkAssessment,
  hour: number,
): CoverageHole {
  const { houses } = terrain;
  const count = houses.length / 3;
  const now = coverageAt(masks, network.liveAt(0));
  const later = coverageAt(masks, network.liveAt(hour));
  const mask = new Uint8Array(count);
  let holes = 0;
  let coveredNow = 0;
  for (let i = 0; i < count; i += 1) {
    const lon = houses[i * 3]!;
    const lat = houses[i * 3 + 1]!;
    if (!now.covers(lon, lat)) continue;
    coveredNow += 1;
    if (later.covers(lon, lat)) continue;
    mask[i] = 1;
    holes += 1;
  }
  return { mask, count: holes, coveredNow };
}
