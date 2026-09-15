/**
 * Shared flood-cut rule and routing over the baked road graph. Used by the
 * renderer (to paint cut roads), by the site evaluation, and by
 * scripts/check-routes.mjs, so every screen and script agrees on what "cut"
 * means. Self-contained on purpose: the check script imports it straight
 * into Node, where bundler-style extensionless imports do not resolve.
 */

export type RoutableEdge = {
  a: number;
  b: number;
  klass: string;
  bridge: boolean;
  km: number;
  /** HAND in decimetres every ~30 m along the drawn polyline; 255 = dry. */
  profile: number[];
  /** Profile index of each drawn point. */
  offsets: number[];
};

export const HAND_DRY_DM = 255;
/** Metres between profile samples, matching the bake. */
export const PROFILE_STEP_METRES = 30;
/** A sample inside a channel (below this) can only be a bridge or culvert. */
export const CHANNEL_HAND_DM = 10;
/** Deck clearance for channel crossings and OSM bridge=yes ways. */
export const BRIDGE_DECK_HAND_DM = 50;
/**
 * Embankment allowance by road class, decimetres. Classified roads are built
 * up above the surrounding ground, which a 30 m DEM cannot see; without this
 * every trunk road on the floodplain reads as flooded at the first metre.
 * Illustrative; a real study would take road-surface heights from LiDAR.
 */
export const EMBANKMENT_HAND_DM: Record<string, number> = {
  motorway: 15,
  trunk: 15,
  primary: 15,
  secondary: 10,
  tertiary: 5,
};
/**
 * A road is cut once at least this much of it is continuously under water.
 * Shorter dips are culverts and DEM noise: SRTM is ~30 m and sees the canopy,
 * not the road embankment. Illustrative; a real system would use LiDAR.
 */
export const CUT_RUN_METRES = 150;

/** Sample HAND with the embankment and crossing rules applied. */
export function liftedHand(edge: RoutableEdge, sample: number) {
  const raised = sample + (EMBANKMENT_HAND_DM[edge.klass] ?? 0);
  return edge.bridge || sample < CHANNEL_HAND_DM
    ? Math.max(raised, BRIDGE_DECK_HAND_DM)
    : raised;
}

/**
 * Per-sample mask of where the edge is cut at the given level: samples that
 * belong to a continuous under-water run of at least CUT_RUN_METRES.
 */
export function cutMask(edge: RoutableEdge, levelMetres: number): boolean[] {
  const wet = edge.profile.map(
    (sample) =>
      sample !== HAND_DRY_DM && liftedHand(edge, sample) / 10 < levelMetres,
  );
  const mask: boolean[] = Array.from({ length: wet.length }, () => false);
  const minSamples = Math.ceil(CUT_RUN_METRES / PROFILE_STEP_METRES);
  let runStart = -1;
  for (let i = 0; i <= wet.length; i += 1) {
    if (i < wet.length && wet[i]) {
      if (runStart < 0) runStart = i;
      continue;
    }
    if (runStart >= 0 && i - runStart >= minSamples) {
      for (let j = runStart; j < i; j += 1) mask[j] = true;
    }
    runStart = -1;
  }
  return mask;
}

export function edgeCutAt(edge: RoutableEdge, levelMetres: number) {
  return cutMask(edge, levelMetres).some(Boolean);
}

/** First forecast hour at which an edge is cut, or null if it stays open. */
export function edgeClosingHour(edge: RoutableEdge, levels: number[]): number | null {
  for (let h = 0; h < levels.length; h += 1) {
    if (edgeCutAt(edge, levels[h]!)) return h;
  }
  return null;
}

export type RouteResult = {
  /** Kilometres from the source per reachable node index. */
  distance: Map<number, number>;
  /** Node each reachable node was reached from, for tracing a route back. */
  previous: Map<number, number>;
};

/**
 * Dijkstra from a graph node over roads (never rail) that are not cut at the
 * level. Small graphs only: a sorted open list is plenty for ~1,300 edges.
 */
export function routeFrom(
  edges: RoutableEdge[],
  source: number,
  levelMetres: number,
): RouteResult {
  const adjacency = new Map<number, { to: number; km: number }[]>();
  for (const edge of edges) {
    if (edge.klass === 'rail' || edgeCutAt(edge, levelMetres)) continue;
    for (const [from, to] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ] as const) {
      let list = adjacency.get(from);
      if (!list) {
        list = [];
        adjacency.set(from, list);
      }
      list.push({ to, km: edge.km });
    }
  }
  const distance = new Map<number, number>([[source, 0]]);
  const previous = new Map<number, number>();
  const open: { node: number; km: number }[] = [{ node: source, km: 0 }];
  while (open.length > 0) {
    open.sort((x, y) => x.km - y.km);
    const { node, km } = open.shift()!;
    if (km > (distance.get(node) ?? Infinity)) continue;
    for (const next of adjacency.get(node) ?? []) {
      const total = km + next.km;
      if (total < (distance.get(next.to) ?? Infinity)) {
        distance.set(next.to, total);
        previous.set(next.to, node);
        open.push({ node: next.to, km: total });
      }
    }
  }
  return { distance, previous };
}

// --- Route evaluation for the site stage --------------------------------------

export type RouteGraph = {
  nodes: [number, number][];
  edges: (RoutableEdge & { points: [number, number][] })[];
};

export type BlockedCrossing = {
  edge: number;
  /** Where the water's edge is, for a marker. */
  lon: number;
  lat: number;
  /** Route kilometres from the depot at which the wave reveals it. */
  revealKm: number;
};

export type RouteEvaluation = {
  level: number;
  /** Route km from the depot to each edge's nearer endpoint; null if unreachable. */
  arrivalKm: (number | null)[];
  /** Whether the wave enters each edge from its `a` end. */
  fromA: boolean[];
  /** First forecast hour at which each lit edge is cut; null if it stays open. */
  closingHour: (number | null)[];
  /** Forecast hour of the river peak, for reading closing hours against. */
  peakHour: number;
  /** Route kilometres from the depot per reachable node index. */
  distanceByNode: Map<number, number>;
  blocked: BlockedCrossing[];
  maxKm: number;
  reachableKm: number;
  cuts: number;
};

/**
 * Routes from the depot at `level` and, for every road the truck can reach,
 * looks ahead along the forecast `levels` (index = hour from now) to find
 * when it closes. Cut roads that touch the reachable network become blocked
 * crossings with a marker at the water's edge.
 */
export function evaluateRoutes(
  graph: RouteGraph,
  depotNode: number,
  level: number,
  levels: number[],
  peakHour: number,
): RouteEvaluation {
  const { distance } = routeFrom(graph.edges, depotNode, level);
  const arrivalKm: (number | null)[] = [];
  const fromA: boolean[] = [];
  const closingHour: (number | null)[] = [];
  const blocked: BlockedCrossing[] = [];
  let maxKm = 0;
  let reachableKm = 0;

  graph.edges.forEach((edge, index) => {
    const atA = distance.get(edge.a);
    const atB = distance.get(edge.b);
    const cut = edge.klass === 'rail' || edgeCutAt(edge, level);
    const reached = atA !== undefined || atB !== undefined;
    const enterFromA = (atA ?? Infinity) <= (atB ?? Infinity);
    fromA.push(enterFromA);

    if (!cut && reached) {
      const arrival = Math.min(atA ?? Infinity, atB ?? Infinity);
      arrivalKm.push(arrival);
      maxKm = Math.max(maxKm, arrival + edge.km);
      reachableKm += edge.km;
      let closes: number | null = null;
      for (let hour = 1; hour < levels.length; hour += 1) {
        if (edgeCutAt(edge, levels[hour]!)) {
          closes = hour;
          break;
        }
      }
      closingHour.push(closes);
      return;
    }

    arrivalKm.push(null);
    closingHour.push(null);
    if (!cut || !reached || edge.klass === 'rail') return;

    // Walk in from the reachable end to the first under-water sample.
    const mask = cutMask(edge, level);
    const order = enterFromA
      ? mask.map((_, i) => i)
      : mask.map((_, i) => mask.length - 1 - i);
    const first = order.find((i) => mask[i]);
    if (first === undefined) return;
    const position = samplePosition(edge, first);
    const fraction = first / Math.max(1, mask.length - 1);
    const along = enterFromA ? fraction : 1 - fraction;
    const from = enterFromA ? atA! : atB!;
    blocked.push({
      edge: index,
      lon: position[0],
      lat: position[1],
      revealKm: from + edge.km * along,
    });
    maxKm = Math.max(maxKm, from + edge.km * along);
  });

  return {
    level,
    arrivalKm,
    fromA,
    closingHour,
    peakHour,
    distanceByNode: distance,
    blocked,
    maxKm,
    reachableKm,
    cuts: blocked.length,
  };
}

/** Longitude/latitude of profile sample `index` along an edge's drawn polyline. */
export function samplePosition(
  edge: RoutableEdge & { points: [number, number][] },
  index: number,
): [number, number] {
  const { points, offsets } = edge;
  for (let k = 0; k < points.length - 1; k += 1) {
    const start = offsets[k]!;
    const end = offsets[k + 1]!;
    if (index > end) continue;
    const u = end > start ? (index - start) / (end - start) : 0;
    const [lon0, lat0] = points[k]!;
    const [lon1, lat1] = points[k + 1]!;
    return [lon0 + (lon1 - lon0) * u, lat0 + (lat1 - lat0) * u];
  }
  return points[points.length - 1]!;
}
