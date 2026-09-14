# ResiliNet 3D UI Concept

An isolated, frontend-only interface prototype for the ResiliNet 3D disaster-response dashboard.

This project does not import from or modify the working ResiliNet application, and it contains no backend, persistence, or operational data. Its economics and population figures are illustrative placeholders; its terrain, hydrology, and line-of-sight geometry are derived from open data at build time.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## The 3D terrain

The map is a three.js scene built from real data for the Sungai Galas valley in Kelantan, from Gunung Stong and Dabong north-east to the Galas–Lebir confluence at Kuala Krai (101.88–102.28 °E, 5.26–5.60 °N, about 44 × 38 km):

- **Why this valley** — it is the scene of the December 2014 *Bah Kuning*, the worst flood in Kelantan's recorded history: the Galas rose roughly 18 m at Dabong, water reached the third floor of a school, the Kemubu railway bridge was swept away, Kampung Kemubu was out of contact for five days, and the Kuala Krai–Gua Musang road partially collapsed. In November 2024 MCMC reported seven transmitter stations and 42 internet hubs across Kelantan and Terengganu shut down by power loss and blocked access — the gap a portable tower is meant to fill. A confined valley with a 1,422 m massif beside it also makes the flood, the severed artery, and the line-of-sight coverage legible at a glance.
- **Elevation** — NASA SRTM 1 arc-second (~30 m) from two tiles (N05E101, N05E102), rendered as a 720 × 612 mesh at ~62 m spacing with 2.6× vertical exaggeration.
- **Surface** — Sentinel-2 cloudless imagery draped as a 4096² mercator texture, with per-vertex UVs computed from longitude/latitude.
- **Flood layer** — a real HAND (Height Above Nearest Drainage) raster, computed at bake time by priority-flood sink filling, a D8 drainage tree, flow accumulation, and a downstream walk to the nearest channel. The flood level is a HAND threshold between 0.5 m and 14 m — set by the gauge reading in the Now stage and by the forecast curve afterwards — and the water sheet sits on the drainage datum plus that level.
- **Roads and railway** — the baked road graph (classified and unclassified OSM roads plus the KTM East Coast line), draped on the terrain and coloured red wherever the cut rule below says the water has closed it.
- **Homes** — OSM building footprints where they exist; elsewhere illustrative houses fill OSM residential areas (one per 0.15 ha) and cluster around OSM settlement nodes, so each kampung reads as a community. Homes are drawn about three times their true footprint for legibility and turn red once the flood reaches them; the badge counts them and each settlement marker shows the number of homes within 1.2 km — an indication of scale, not a census.
- **Coverage** — a line-of-sight viewshed (`lib/viewshed.ts`, 96 rays × 60 rings, 9 km, 32 m mast) marched over the real elevation grid, so ridges genuinely shadow it. The same mask draws the fans and counts the homes a mast can see.
- **Tower candidates** — patches of dry ground 40–350 m above the floodplain datum, within 4 km of a settlement and 300 m of a road, at least 1 km apart, and **buildable**: the site and its ring of 30 m neighbours must all be under a 10° slope, so hillsides that score well on line of sight but could never take a truck-mounted mast are excluded. Each is named after its nearest settlement; the first is the opening concept tower. The slope test reads SRTM at 30 m, so it accepts gentle average slopes — a real siting pass would use LiDAR plus a ground and access check.

Sources for the scenario narrative: [2014–15 Malaysia floods](https://en.wikipedia.org/wiki/2014%E2%80%9315_Malaysia_floods), [FloodList](https://floodlist.com/asia/malaysia-floods-kelantan-worst-recorded-costs), [Macaranga on Dabong](https://www.macaranga.org/embed/forestsgone_202301/floodkelantan.html), [The Star, 28 Nov 2024](https://www.thestar.com.my/news/nation/2024/11/28/seven-transmitter-stations-42-internet-hubs-in-kelantan-terengganu-hit-by-floods).

## The flow: Now → Forecast → Site

The dashboard walks an emergency communications officer through one decision in three stages.

1. **Now.** The officer enters the Kuala Krai gauge reading (JPS InfoBanjir telemetry; danger level 25.0 m, 2014 record 34.2 m). Every metre above danger level is taken as a metre of water above the drainage datum — an illustrative mapping that a real deployment would replace with a rating curve — and the valley floods live.
2. **Forecast.** The camera flies up to a top-down overview. An hourly rain forecast drifts over the catchment while a river-level timeline along the bottom shows the predicted curve with the peak pinned; settlement labels show how hard it is raining in each place. The officer picks the hour to plan for — the peak by default — and flies back down.
3. **Site.** One **Start** button runs the evaluation in two visible phases. First the reachable road network lights up outward from the Kuala Krai depot at *today's* level, each road tinted by when the forecast will close it (green: open through the peak; amber: closes before the peak; rose: closes within two hours), with a red mark at every crossing the water has already taken. Then the candidates the truck can reach spawn one by one along the lit roads, each flashing its coverage and counting the homes it would reconnect. The best site gets the mast, its coverage fan, and a card; runners-up shrink to badges that preview their coverage on tap. No decision buttons — the map is the ranking.

Reset returns to Now with the gauge reading kept. Everything runs offline from the baked assets.

## Forecast model

`public/forecast.json` is illustrative (`scripts/make-forecast.mjs` draws a convective band that forms over Gunung Stong and drifts north-east along the valley, peaking around hour 6) and is labelled as such; its hour 0 is always the real current time. The file shape — an hourly rain grid over the AOI plus the catchment mean — is what MET Malaysia nowcasts or NASA GPM IMERG would fill.

`lib/forecast.ts` turns catchment rain into a river level with a leaky store: each hour the level rises by `RUNOFF_COEF` (0.11 m per mm/h) times the rain that fell `LAG_HOURS` (2) earlier, and drains by `RECESSION` (0.12) of its height above `BASE_LEVEL` (0.5 m), clamped to 0.5–14 m and starting from the observed reading. All four constants are illustrative; the comments beside them say where a real value comes from (rating curve, unit hydrograph, fitted recession, time of concentration). `node scripts/check-forecast.mjs` prints the curve.

## Road graph and the cut rule

The bake builds a junction-preserving graph from OSM node ids (`public/terrain/roads.json`: nodes, edges with class, length, `bridge=yes`, and a HAND profile every 30 m along each edge, split into ≤1 km pieces). Unclassified roads are included because without them the classified network splits into two halves that only meet outside the AOI. The depot is the Kuala Krai town node snapped onto the road graph.

`lib/routing.ts` holds the one rule the map, the router and the check script share: a road is cut at a level when at least 150 m of it is continuously under water. Before that test, samples inside a channel and `bridge=yes` ways get a 5 m deck clearance (bridges and culverts), and classified roads get an embankment allowance (trunk/primary +1.5 m, secondary +1.0 m, tertiary +0.5 m) because a 30 m DEM sees the canopy rather than the road surface. All of these are illustrative; a real study would take road-surface heights from LiDAR. `node scripts/check-routes.mjs [levels…]` prints reachability per candidate.

## Existing network sites

The bake writes `sites` to `terrain.json` from two sources. OpenStreetMap knows exactly one communication tower in the AOI. OpenCellID knows ~1,100 cells, but each is a single crowd-sourced sample of where a phone *heard* the cell — often on the road or in the river — so one macro site appears as a cloud of points. The bake clusters cells within 1.2 km, keeps a cluster only when at least 3 cells or 2 operators corroborate it, picks the strongest clusters at least 2.5 km apart (up to 12), merges the OSM tower with its cloud, and **snaps every site to the highest dry ground (HAND ≥ 3 m) within 500 m** — the assumption being that a real site stands on the nearest rise, not in the channel the samples landed in. Operators come from the MNC codes. If fewer than eight sites result the bake tops up from a `SITE_SEEDS` table (one per major settlement on high ground beside a road: Kuala Krai town and bypass, Manek Urai, Kuala Gris, Dabong, Kemubu, Kuala Balah, Jelawang), each flagged `source: 'seed'` and labelled *seed* on the map. **Seeds are placeholders, not real infrastructure.**

Each site carries what the failure model needs, all of it assumptions until an operator supplies real figures: a 45 m mast unless OSM tags a height; grid power with a **6 h battery**, plus a **genset** for sites within 2.5 km of Kuala Krai town; the road-graph node it is reached from; and a backhaul parent by a simple rule — sites within 1 km of the trunk or primary road are **fibre** and chain toward the Kuala Krai hub (the site nearest the town), every other site is a **microwave** link to the nearest site that can see its mast (a straight ray over the DEM with 5 m clearance; the nearest site regardless if none can). Real backhaul topology is operator-confidential; this rule is the stand-in.

## Site evaluation

`lib/sites.ts`: a candidate is assessed if the route wave reached its road node at today's level. Its score is the number of homes that are under water at the planned hour *and* inside its viewshed — the homes it would reconnect. The winner has the highest count; a tie goes to the shorter road. The card reports the winner's height above the planned flood, road distance from the depot, and the count; the browser console logs the full table.

## Moving around

Drag to pan across the terrain. On a trackpad, pinch zooms toward the pointer, a two-finger scroll up or down flies the camera higher or lower, and a two-finger swipe left or right orbits the pivot; with a mouse, the wheel does the same (horizontal wheel orbits) and right-drag or ⌃-drag rotates. Zoom is eased rather than stepped, damping is scaled to the real frame interval so 60 Hz and 120 Hz displays feel the same, the pivot is re-grounded only after a gesture ends, and the render resolution adapts to measured frame times (a little lower during a gesture, full Retina density at rest). The camera drifts slowly once you stop interacting, and holds still under `prefers-reduced-motion`.

## Rebaking the terrain assets

`public/terrain/` is committed so the app runs offline with no API key. To regenerate it:

```bash
npm run bake:terrain
```

The script downloads its inputs once into `.cache/` (gitignored) and writes `elevation.bin`, `hand.bin`, `houses.bin`, `roads.json`, `surface.jpg`, and `terrain.json`. `node scripts/make-forecast.mjs` regenerates the illustrative forecast.

## Data sources

- Elevation: NASA SRTM 1 arc-second, via the AWS Open Data `elevation-tiles-prod` bucket.
- Imagery: Sentinel-2 cloudless 2020 by EOX IT Services GmbH, CC BY 4.0, based on modified Copernicus Sentinel data 2020.
- Roads, railway, settlements, residential areas and buildings: © OpenStreetMap contributors, ODbL.
- Network sites: OpenStreetMap `man_made=mast` / `communications_tower` / `tower` + `tower:type=communication` (ODbL); OpenCellID cells clustered within 300 m when `OPENCELLID_KEY` is set at bake time (CC BY-SA 4.0 — get a free key at opencellid.org → account → API keys); hand-placed seeds where the map is empty.

## Checks

```bash
npx tsc --noEmit
npx oxlint app components lib scripts
npm run build
```
