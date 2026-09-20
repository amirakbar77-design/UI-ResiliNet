/**
 * The December 2014 hindcast: four reported facts about the flood everyone
 * remembers, each checked against what the model says at the recorded peak.
 * Hits and misses are stated as they fall; nothing here is tuned to pass.
 * Shared by the Now-stage block in Hindcast mode and scripts/check-hindcast.mjs.
 */

import { handLevelToGauge } from './gauge.ts';
import { MAPS, type GaugeSpec } from './maps.ts';
import type { NetworkAssessment, NetworkSiteState } from './network.ts';
import { edgeCutAt, routeFrom } from './routing.ts';
import { metresPerDegreeLon, type TerrainData } from './terrain-field.ts';
import type { ViewshedMask } from './viewshed.ts';

/** Rail bridges this close to the Kemubu place node are "the Kemubu bridge". */
const BRIDGE_SEARCH_M = 1500;
/** Sites this close to the Kuala Krai town node are "the town sites". */
const TOWN_RADIUS_M = 4000;
/** Reachable-by-road thresholds for "isolated". */
const ISOLATED_KM = 5;
const HEMMED_IN_KM = 20;

export const HINDCAST_2014 = {
  /** The recorded peak at the Kuala Krai gauge, 24–25 Dec 2014. */
  gauge: 34.2,
  label: 'Hindcast · Dec 2014',
};

export type HindcastVerdict = 'hit' | 'partial' | 'miss';

export type HindcastCheck = {
  key: 'bridge' | 'isolated' | 'kemubu' | 'town';
  /** What was reported. */
  fact: string;
  source: string;
  /** What the model says at the checked level. */
  model: string;
  /** The same in a few words, for the panel. */
  short: string;
  verdict: HindcastVerdict;
};

const metresBetween = (aLon: number, aLat: number, bLon: number, bLat: number) =>
  Math.hypot((aLon - bLon) * metresPerDegreeLon((aLat + bLat) / 2), (aLat - bLat) * 110_574);

const fate = (state: NetworkSiteState) =>
  state.status === 'down'
    ? 'down at the peak'
    : state.failureHour === null
      ? 'survives the horizon'
      : `dark by +${state.failureHour} h`;

/** Runs the four checks at `level` (HAND metres) against the network assessed for it. */
export function hindcastChecks(
  terrain: TerrainData,
  network: NetworkAssessment,
  masks: Map<string, ViewshedMask>,
  level: number,
  /** The station these facts belong to; only Kuala Krai has checked ones. */
  spec: GaugeSpec = MAPS.kelantan.gauge,
): HindcastCheck[] {
  const gaugeOf = (value: number) => handLevelToGauge(value, spec).toFixed(1);
  const { meta, graph } = terrain;
  const checks: HindcastCheck[] = [];
  const kemubu = meta.places.find((p) => /kemubu/i.test(p.name)) ?? null;
  const town = meta.places.find((p) => /kuala krai/i.test(p.name)) ?? { lon: meta.depot.lon, lat: meta.depot.lat };

  // 1. The Kemubu railway bridge: the longest rail bridge edge near the village.
  {
    const candidates = kemubu
      ? graph.edges
          .filter((e) => e.klass === 'rail' && e.bridge)
          .map((e) => ({ e, d: Math.min(...e.points.map(([lon, lat]) => metresBetween(lon, lat, kemubu.lon, kemubu.lat))) }))
          .filter((x) => x.d <= BRIDGE_SEARCH_M)
          .sort((a, b) => b.e.km - a.e.km)
      : [];
    const bridge = candidates[0]?.e ?? null;
    if (!bridge) {
      checks.push({
        key: 'bridge',
        fact: 'Kemubu railway bridge lost',
        source: 'Malaysiakini, 30 Dec 2014: the iron railway bridge at Kemubu collapsed; the East Coast line stayed shut for years',
        model: kemubu ? 'no rail bridge within 1.5 km of Kemubu in the baked graph' : 'Kemubu is not among the baked places',
        short: 'not in the baked graph',
        verdict: 'miss',
      });
    } else {
      let firstCut: number | null = null;
      for (let l = 0.5; l <= 14; l = Math.round((l + 0.1) * 10) / 10) {
        if (edgeCutAt(bridge, l)) {
          firstCut = l;
          break;
        }
      }
      const cut = edgeCutAt(bridge, level);
      checks.push({
        key: 'bridge',
        fact: 'Kemubu railway bridge lost',
        source: 'Malaysiakini, 30 Dec 2014: the iron railway bridge at Kemubu collapsed; the East Coast line stayed shut for years',
        model: cut
          ? `the ${Math.round(bridge.km * 1000)} m rail bridge is cut, from a gauge of ${gaugeOf(firstCut!)} m`
          : `the ${Math.round(bridge.km * 1000)} m rail bridge stays open at ${gaugeOf(level)} m`,
        short: cut ? `cut from a ${gaugeOf(firstCut!)} m gauge` : `still open at ${gaugeOf(level)} m`,
        verdict: cut ? 'hit' : 'miss',
      });
    }
  }

  // 2. Kuala Krai cut off by road: how far the depot can still reach.
  {
    const reach = (l: number) => {
      const { distance } = routeFrom(graph.edges, meta.depot.node, l);
      let km = 0;
      let farthest = 0;
      for (const e of graph.edges) {
        if (distance.has(e.a) && distance.has(e.b) && !edgeCutAt(e, l)) km += e.km;
      }
      for (const d of distance.values()) farthest = Math.max(farthest, d);
      return { km, farthest };
    };
    const now = reach(level);
    const dry = reach(0.5);
    const verdict: HindcastVerdict = now.farthest <= ISOLATED_KM ? 'hit' : now.farthest <= HEMMED_IN_KM ? 'partial' : 'miss';
    checks.push({
      key: 'isolated',
      fact: 'Kuala Krai cut off by road',
      source: 'FloodList and the ANCST report on the December 2014 flood: the town was isolated in the worst flood on record',
      model: `${now.km.toFixed(0)} km of road reachable from the depot (${dry.km.toFixed(0)} km when dry), nothing beyond ${now.farthest.toFixed(1)} km`,
      short: `${now.km.toFixed(0)} km of road reachable, nothing beyond ${now.farthest.toFixed(1)} km`,
      verdict,
    });
  }

  // 3. Kampung Kemubu out of contact: is every site that sees it dark?
  {
    if (!kemubu) {
      checks.push({
        key: 'kemubu',
        fact: 'Kampung Kemubu out of contact for days',
        source: 'Kelantan Flood 2014: reflections from a relief-aid mission to Kampung Kemubu (Mediterranean Journal of Social Sciences, 2015)',
        model: 'Kemubu is not among the baked places',
        short: 'not among the baked places',
        verdict: 'miss',
      });
    } else {
      const covering = network.sites.filter((s) => masks.get(s.id)?.covers(kemubu.lon, kemubu.lat));
      if (covering.length === 0) {
        const nearest = [...network.sites]
          .map((s) => ({ s, d: metresBetween(s.site.lon, s.site.lat, kemubu.lon, kemubu.lat) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 2);
        checks.push({
          key: 'kemubu',
          fact: 'Kampung Kemubu out of contact for days',
          source: 'Kelantan Flood 2014: reflections from a relief-aid mission to Kampung Kemubu (Mediterranean Journal of Social Sciences, 2015)',
          model: `no modelled site sees Kemubu even before the flood (nearest: ${nearest.map(({ s, d }) => `${s.site.name} ${(d / 1000).toFixed(1)} km, ${fate(s)}`).join('; ')}), so the model cannot lose what it never had`,
          short: 'no modelled site sees Kemubu, so it cannot lose it',
          verdict: 'miss',
        });
      } else {
        const dark = covering.filter((s) => s.failureHour !== null);
        const by = Math.max(...dark.map((s) => s.failureHour!));
        const verdict: HindcastVerdict = dark.length === covering.length ? 'hit' : dark.length > 0 ? 'partial' : 'miss';
        checks.push({
          key: 'kemubu',
          fact: 'Kampung Kemubu out of contact for days',
          source: 'Kelantan Flood 2014: reflections from a relief-aid mission to Kampung Kemubu (Mediterranean Journal of Social Sciences, 2015)',
          model: `${covering.map((s) => `${s.site.name} ${fate(s)}`).join(', ')}${verdict === 'hit' ? ` — no signal from +${by} h` : ''}`,
          short: verdict === 'hit' ? `no signal from +${by} h` : `${dark.length} of ${covering.length} covering sites go dark`,
          verdict,
        });
      }
    }
  }

  // 4. Maxis and Digi down in Kuala Krai: the town's sites.
  {
    const townSites = network.sites.filter((s) => metresBetween(s.site.lon, s.site.lat, town.lon, town.lat) <= TOWN_RADIUS_M);
    const downNow = townSites.filter((s) => s.status === 'down');
    const darkSoon = townSites.filter((s) => s.status === 'down' || (s.failureHour !== null && s.failureHour <= 8));
    const darkEver = townSites.filter((s) => s.failureHour !== null);
    const latest = darkEver.length ? Math.max(...darkEver.map((s) => s.failureHour!)) : null;
    const verdict: HindcastVerdict =
      townSites.length > 0 && darkSoon.length === townSites.length
        ? 'hit'
        : darkEver.length === townSites.length && townSites.length > 0
          ? 'partial'
          : 'miss';
    checks.push({
      key: 'town',
      fact: 'Maxis and Digi down in Kuala Krai, Celcom up',
      source: 'Malaysiakini and Yahoo News, 26 Dec 2014: Gua Musang, Kuala Krai and Tanah Merah lost phone and internet service; MCMC said the same day that systems were still running',
      model:
        townSites.length === 0
          ? 'no modelled site within 4 km of the town'
          : `${downNow.length} of ${townSites.length} town sites down at the peak (${townSites.map((s) => `${s.site.name} ${fate(s)}`).join(', ')})${latest !== null && darkEver.length === townSites.length ? `; all dark by +${latest} h` : ''}; operators are not separable — every OpenCellID cluster here carries all networks`,
      short:
        townSites.length === 0
          ? 'no modelled site in town'
          : `${downNow.length} of ${townSites.length} town sites down at the peak${latest !== null && darkEver.length === townSites.length ? `, all by +${latest} h` : ''} · operators not separable`,
      verdict,
    });
  }

  return checks;
}
