# ResiliNet 3D UI Concept

An isolated, frontend-only interface prototype for the ResiliNet 3D disaster-response dashboard.

**Purpose.** An emergency-communications officer, during a flood, decides where to send the one portable tower and the one generator convoy so that the most people keep signal before the roads close. Everything else in this app exists only to make that decision credible.

This project does not import from or modify the working ResiliNet application, and it contains no backend, persistence, or operational data. Its economics are illustrative placeholders; its terrain, hydrology, population, and line-of-sight geometry are derived from open data at build time.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Three valleys, two countries

The place chip above the layer panel switches between three baked areas. The engine is the same for all of them — routing, viewsheds, the network model, the recommendation and the population counts read only from the baked assets — so a valley is a bake plus an entry in `lib/maps.ts`. The third is outside Malaysia on purpose: every input is a global open dataset, and the Vietnamese valley is the proof.

| | **Dabong – Kuala Krai** | **Beaufort & the Padas gorge** | **Yên Bái** |
|---|---|---|---|
| River, country | Sungai Galas, Kelantan, Malaysia | Sungai Padas, Sabah, Malaysia | Sông Thao (upper Red River), Vietnam |
| Box | 101.88–102.28 °E, 5.26–5.60 °N | 115.52–115.92 °E, 5.12–5.46 °N | 104.70–105.10 °E, 21.55–21.89 °N |
| Depot | Kuala Krai | Beaufort | Yên Bái |
| Gauge | Kuala Krai, danger 25.0 m | Beaufort, danger 8.70 m | Yên Bái, alarm level III 32.0 m |
| Highest reading used | 34.2 m (the Dec 2014 record) | 9.68 m (highest **found**, not a stated record) | 35.73 m (the Sep 2024 record, Typhoon Yagi) |
| Rain inputs | scenario + three dated feeds | scenario only | scenario only |
| Hindcast | four checked 2014 facts | none — the app says so | none — the app says so |
| People (WorldPop) | 101,384 | 68,876 | 374,352 |
| OSM buildings in the box | 278 | 1,194 | 11,260 |

**Why Yên Bái.** Typhoon Yagi (September 2024) is the largest telecommunications outage from a flood in recent ASEAN memory: Vietnam's Ministry of Information and Communications counted **6,285 mobile base stations** knocked out across 15 provinces, with 3,010 brought back on generators and full restoration "dependent on the re-establishment of grid power" — which is this app's failure model, stated by a regulator. At the Yên Bái gauge the Sông Thao reached **35.73 m at 16:00 on 10 September**, 3.73 m over alarm level III and 1.31 m above the 1968 flood, the highest in the station's record; the province declared an emergency with 23,400 homes damaged. The city sits where the river leaves the hills, so the valley has the relief the candidate rule needs and a single connected road network with the depot on it. WorldPop's Vietnam raster is the same product as Malaysia's, so the counts are comparable.

**Why the Padas.** Beaufort is one of the most chronically flooded towns in Malaysia — it crosses its danger level most years, and the reports for those events describe dozens of villages inundated, thousands displaced and a declared disaster zone. It also carries the sharpest version of the problem this app exists for: the gorge villages of **Pangi, Rayoh and Halogilat have no road at all** and are reached only by the Sabah State Railway, the same railway the river can cut. Power loss has taken out supply to ~10,000 consumers across Beaufort and Tenom in a single flood.

**Why the box stops short of Tenom.** No road crosses the Padas gorge; the driving route from Beaufort to Tenom loops far east via Keningau, well outside any box at this scale. An earlier, wider AOI put Tenom inside the frame, and the result was two disconnected road networks with every tower candidate stranded on the far side — the truck could reach none of them. The box now covers one connected road network plus the roadless gorge villages.

**What the Padas and Yên Bái maps do not have.** No HydroBASINS trace, so its catchment mean is a tile mean rather than a basin mean, and the three dated feeds have no file for it. No rating curve and no checked historical event. Its river constants are illustrative and the method sheet states this instead of citing sources it does not have.

## The 3D terrain

The map is a three.js scene built from real data. For the Sungai Galas valley in Kelantan, from Gunung Stong and Dabong north-east to the Galas–Lebir confluence at Kuala Krai (101.88–102.28 °E, 5.26–5.60 °N, about 44 × 38 km):

- **Why this valley** — it is the scene of the December 2014 *Bah Kuning*, the worst flood in Kelantan's recorded history: the Galas rose roughly 18 m at Dabong, water reached the third floor of a school, the Kemubu railway bridge was swept away, Kampung Kemubu was out of contact for five days, and the Kuala Krai–Gua Musang road partially collapsed. In November 2024 MCMC reported seven transmitter stations and 42 internet hubs across Kelantan and Terengganu shut down by power loss and blocked access — the gap a portable tower is meant to fill. A confined valley with a 1,422 m massif beside it also makes the flood, the severed artery, and the line-of-sight coverage legible at a glance.
- **Elevation** — NASA SRTM 1 arc-second (~30 m) from two tiles (N05E101, N05E102), rendered as a 720 × 612 mesh at ~62 m spacing with 2.6× vertical exaggeration.
- **Surface** — Sentinel-2 cloudless imagery draped as a 4096² mercator texture, with per-vertex UVs computed from longitude/latitude.
- **Flood layer** — a real HAND (Height Above Nearest Drainage) raster, computed at bake time by priority-flood sink filling, a D8 drainage tree, flow accumulation, and a downstream walk to the nearest channel. The flood level is a HAND threshold between 0.5 m and 14 m — set by the gauge reading in the Now stage and by the forecast curve afterwards — and the water sheet sits on the drainage datum plus that level.
- **Roads and railway** — the baked road graph (classified and unclassified OSM roads plus the KTM East Coast line), draped on the terrain and coloured red wherever the cut rule below says the water has closed it.
- **Population** — WorldPop 2020, UN-adjusted, constrained to built-up areas, ~100 m (CC BY 4.0; `hub.worldpop.org/geodata/summary?id=49771`), cropped to the AOI and summed onto the render grid as `population.bin`. **Every count in the app — without signal, reconnected, kept on signal, the settlement labels — is people from this raster.**
- **Homes** — drawn for the 3D view only, and illustrative: OSM building footprints where they exist, elsewhere houses filling OSM residential areas (one per 0.15 ha) and clustered around settlement nodes, so a kampung reads as a community. They turn red once the flood reaches them. They are never counted.
- **Coverage** — a line-of-sight viewshed (`lib/viewshed.ts`, 96 rays × 60 rings, 9 km, 32 m mast) marched over the real elevation grid, so ridges genuinely shadow it. The same mask draws the fans and counts the homes a mast can see.
- **Tower candidates** — patches of dry ground 40–350 m above the floodplain datum, within 4 km of a settlement and 300 m of a road, at least 1 km apart, and **buildable**: the site and its ring of 30 m neighbours must all be under a 10° slope, so hillsides that score well on line of sight but could never take a truck-mounted mast are excluded. Each is named after its nearest settlement; the first is the opening concept tower. The slope test reads SRTM at 30 m, so it accepts gentle average slopes — a real siting pass would use LiDAR plus a ground and access check.

Sources for the scenario narrative: [2014–15 Malaysia floods](https://en.wikipedia.org/wiki/2014%E2%80%9315_Malaysia_floods), [FloodList](https://floodlist.com/asia/malaysia-floods-kelantan-worst-recorded-costs), [Macaranga on Dabong](https://www.macaranga.org/embed/forestsgone_202301/floodkelantan.html), [The Star, 28 Nov 2024](https://www.thestar.com.my/news/nation/2024/11/28/seven-transmitter-stations-42-internet-hubs-in-kelantan-terengganu-hit-by-floods).

## The flow: Now → Forecast → Site

The dashboard walks an emergency communications officer through one decision in three stages.

1. **Now.** The officer enters the gauge reading (JPS InfoBanjir telemetry; Kuala Krai danger level 25.0 m, 2014 record 34.2 m; Beaufort danger level 8.70 m). Each metre above danger level becomes a fixed number of metres of water above the drainage datum — an illustrative straight line that a real deployment would replace with a rating curve — and the valley floods live. The slope is 1 at Kuala Krai, where a gauge in a narrow valley channel climbs about as fast as the water deepens. It is 2.9 at Beaufort, where the channel is wide and flat: the whole sourced band above danger is roughly a metre, yet at 9.4–9.9 m the reports describe dozens of villages flooded and a declared disaster zone, which a 1:1 slope would render as a nuisance. That figure is anchored to reported impact, not to a rating curve we hold, and the method sheet says so.
2. **Forecast.** The camera flies up to a top-down overview. An hourly rain forecast drifts over the catchment while a river-level timeline along the bottom shows the predicted curve with the peak pinned; settlement labels show how hard it is raining in each place. The officer picks the hour to plan for — the peak by default — and flies back down.
3. **Site.** One **Start** button runs the evaluation in two visible phases. First the reachable road network lights up outward from the Kuala Krai depot at *today's* level, each road tinted by when the forecast will close it (green: open through the peak; amber: closes before the peak; rose: closes within two hours), with a red mark at every crossing the water has already taken. Then the candidates the truck can reach spawn one by one along the lit roads, each flashing its coverage and counting the homes it would reconnect. The best site gets the mast, its coverage fan, and a card; runners-up shrink to badges that preview their coverage on tap. No decision buttons — the map is the ranking.

Reset returns to Now with the gauge reading kept. Everything runs offline from the baked assets.

## Rain: a design storm and three dated feeds

The chip beside the clock on the Now stage cycles four inputs. The first is a **scenario**: a synthetic design storm drawn for the demo, labelled as such on the chip and in its file, the way flood planners use a design storm. It is the default because it tells the whole story in one sitting: rain arrives, the river climbs, roads close one by one, sites go dark, and the plan says where the convoy and the portable tower go while they can still get there. The other three are real, dated feeds fetched at bake time and committed as JSON so the demo runs offline. All four run through the same river model and the same network model:

| Mode | File | Source | Terms | Hour 0 |
|---|---|---|---|---|
| **Scenario · design storm** | `public/forecast.json` | synthetic convective band over Gunung Stong drifting north-east along the valley, peaking at hour 6 (`scripts/make-forecast.mjs`); the catchment mean is a tile mean | none: not a forecast | the current hour |
| **Live** | `public/forecast-live.json` | Google DeepMind **WeatherNext 3** statistics (experimental): IMERG-calibrated hourly precipitation, ensemble mean and p10/p50/p90, 0.1° grid, newest 00/06/12/18Z init, leads 1–48 h (`scripts/fetch-weathernext.py`, `npm run forecast:live`) | GDM Real-Time Weather Forecasting Experimental Data Terms (real-time); CC BY 4.0 (historic) | the current hour (the file is trimmed to "now" once an hour) |
| **Replay · 27 Nov 2024** | `public/forecast-2024.json` | **WeatherNext 2** ensemble-mean archive on Earth Engine (`weathernext_2_0_0_mean`, 6-hourly, ~28 km), issue 2024-11-27 00Z, hours 0–72, with a lagged-ensemble band (p10/p50/p90 across the 26 Nov 00/06/12/18Z and 27 Nov 00Z issues for the same valid hour) (`scripts/fetch-replay.py`, `npm run forecast:replay`) | CC BY 4.0 | the issue time |
| **Hindcast · 22 Dec 2014** | `public/forecast-2014.json` | **ERA5-Land** reanalysis (observation-based, ECMWF/C3S, hourly, ~11 km), 2014-12-22 06Z + 72 h, no band | Copernicus C3S licence | the start time |

**The basin.** Every catchment mean is the area-weighted mean over `public/terrain/basin.geojson`: HydroBASINS v1 level 9 traced upstream from the Kuala Krai gauge (102.199 E, 5.531 N) — 37 polygons, 11,502 km², dissolved. The river at Kuala Krai answers to that whole basin; the illustrative file's tile mean was a hydrology error.

**What WeatherNext 3 gives, and does not.** Hourly, ~10 km, IMERG-calibrated ensemble statistics with a real spread, which is why the timeline can draw a p10–p90 band and tag the peak "8.9 m (7.5–10.4)". It does not resolve convective cells inside the valley (the 16×14 app grid is the 0.1° ensemble mean interpolated across roughly 4×3 model cells — a gradient, not storm cells) and its extremes are smoothed. The app plans on p50. **On a dry day Live shows no action — that is the system working.**

**What each mode shows.** Replay 2024: 151 mm of basin-mean rain over the 72 h (the five issues agree within 149–178 mm), the rain arriving from hour 0. Hindcast 2014: 119 mm in the 72 h from 22 Dec 06Z in ERA5-Land, which is known to understate this event (station totals exceeded 1,000 mm that week). The recorded gauge readings at the two hour-0 times were not found; the files say so and the app keeps its 27.0 m default (Bernama reported 25.17 m at Kuala Krai on 29 Nov 2024 08:00 MYT; the 2014 flood peaked at the 34.2 m record on 25 Dec). `node scripts/check-forecast.mjs [live|replay-2024|hindcast-2014] [level]` prints any file with its band.

**Known limit, on purpose.** The river-model constants below were set against the illustrative file's tile-mean rain (up to 19 mm/h); real basin means run 1–4 mm/h, so with these constants both replays raise the modelled river by only about 1 m. Step 17 calibrates the constants against the 2014 event and says so here; they are not tuned quietly.

If the live file is missing the Live chip says so and shows the scenario.

**How the three screens behave.** The Forecast stage plays itself once per event, from now to the end of the horizon in about eight seconds, then settles on the planning hour (the outage hour, or the river peak when nothing fails); a viewer who prefers reduced motion gets the settled chart directly. Settlement labels give way to any site, candidate, depot or tower marker they would collide with, so the decision markers are always readable. The Site view keeps the camera over the tile so its edge never shows, and eases toward the depot when Start is pressed so the route wave sets off in front of the viewer. On a phone the overview fits the whole tile in portrait and the timeline stacks its readout above its buttons.

`lib/forecast.ts` turns catchment rain into a river level with a leaky store: each hour the level rises by `RUNOFF_COEF` (0.11 m per mm/h) times the rain that fell `LAG_HOURS` (2) earlier, and drains by `RECESSION` (0.12) of its height above `BASE_LEVEL` (0.5 m), clamped to 0.5–14 m and starting from the observed reading. All four constants are illustrative; the comments beside them say where a real value comes from (rating curve, unit hydrograph, fitted recession, time of concentration). `node scripts/check-forecast.mjs` prints the curve.

## Road graph and the cut rule

The bake builds a junction-preserving graph from OSM node ids (`public/terrain/roads.json`: nodes, edges with class, length, `bridge=yes`, and a HAND profile every 30 m along each edge, split into ≤1 km pieces). Unclassified roads are included because without them the classified network splits into two halves that only meet outside the AOI. The depot is the Kuala Krai town node snapped onto the road graph.

`lib/routing.ts` holds the one rule the map, the router and the check script share: a road is cut at a level when at least 150 m of it is continuously under water. Before that test, samples inside a channel and `bridge=yes` ways get a 5 m deck clearance (bridges and culverts), and classified roads get an embankment allowance (trunk/primary +1.5 m, secondary +1.0 m, tertiary +0.5 m) because a 30 m DEM sees the canopy rather than the road surface. All of these are illustrative; a real study would take road-surface heights from LiDAR. `node scripts/check-routes.mjs [levels…]` prints reachability per candidate.

## Existing network sites

The bake writes `sites` to `terrain.json` from two sources. OpenStreetMap knows exactly one communication tower in the AOI. OpenCellID knows ~1,100 cells, but each is a single crowd-sourced sample of where a phone *heard* the cell — often on the road or in the river — so one macro site appears as a cloud of points. The bake clusters cells within 1.2 km, keeps a cluster only when at least 3 cells or 2 operators corroborate it, picks the strongest clusters at least 2.5 km apart (up to 12), merges the OSM tower with its cloud, and **snaps every site to the highest dry ground (HAND ≥ 3 m) within 500 m** — the assumption being that a real site stands on the nearest rise, not in the channel the samples landed in. Operators come from the MNC codes. If fewer than eight sites result the bake tops up from a `SITE_SEEDS` table (one per major settlement on high ground beside a road: Kuala Krai town and bypass, Manek Urai, Kuala Gris, Dabong, Kemubu, Kuala Balah, Jelawang), each flagged `source: 'seed'` and labelled *seed* on the map. **Seeds are placeholders, not real infrastructure.**

Each site carries what the failure model needs, all of it assumptions until an operator supplies real figures: a 45 m mast unless OSM tags a height; grid power with an **8 h battery**, plus a **genset** for sites within 2.5 km of Kuala Krai town; the road-graph node it is reached from; and a backhaul parent by a simple rule — sites within 1 km of the trunk or primary road are **fibre** and chain toward the Kuala Krai hub (the site nearest the town), every other site is a **microwave** link to the nearest site that can see its mast (a straight ray over the DEM with 5 m clearance; the nearest site regardless if none can). Real backhaul topology is operator-confidential; this rule is the stand-in.

## Existing-site failure model

`lib/network.ts` decides, for every existing site, whether it is up, on battery or down right now and when the forecast takes it down — the earliest of three mechanisms, each a stand-in for what an operator's NOC would know per site:

- **inundation** — the first forecast hour the river passes the site's HAND (the cabinet goes under);
- **power** — the grid is assumed to fail with the flood; the site runs on battery (`BATTERY_HOURS` = 8, illustrative; rural macro sites carry 4–8 h) and is refuellable only while a crew can bring diesel from a **fuel source** — the town or an OSM petrol station (`terrain.json` `fuelSources`: Kuala Krai plus five stations) — within `FUEL_RUN_KM` = 25 by roads that are not cut (a multi-source Dijkstra per forecast hour); when that stops being true the clock starts, and a genset site gets one refuelling's worth of extra hours (`GENSET_HOURS` = 12). Judging access from the depot alone wrote off every site the moment one link near town closed; judging it from any village made nothing ever fail, because villages have no diesel; petrol stations by open road is the honest middle;
- **backhaul** — a site dies when its parent dies (fibre along a cut road, a dark microwave hop); the hub has no parent and never loses backhaul.

Failures beyond the forecast horizon count as surviving it. The officer's reports go in by tapping a site's marker: the first tap reports it **down**, the next that it is **fine** (it has fuel and survives the horizon), then **on battery**, then back to the model. A report wins over the model and is tagged *reported*; once a plan is on screen, a report re-plans at once — the card, the winner and the convoy ring move without replaying the wave. That is the demo's moment: "the operator just called, Kuala Balah is under water" — tap — and the plan moves to Jelawang — this is where NOC alarms would enter. Status dots (green / amber / red) on the Now stage follow the gauge; on the Forecast stage each failure is a tick on the river timeline (red inundation, amber power, grey backhaul, blue manual) and the readout says how many sites are dark by the selected hour. `node scripts/check-network.mjs [gauge]` prints the table.

In this valley every real site sits on dry ground, so inundation is rare and **power after the access road closes** dominates — which is what MCMC reported in November 2024.

## The coverage hole

Flooding alone does not take anyone off the network — a flooded home under a working site still has signal. `coverageHole` in `lib/network.ts` unions the line-of-sight viewsheds (9 km, each site's mast height) of every site as built and of those still live at the planned hour; the **hole** is the people (WorldPop cells, `lib/population.ts`) the network normally covers that no surviving site covers then. Counting from the network as built, not from "live now", means a site the officer reports down adds its people to the hole rather than dropping them out of it. The Site stage's headline "without signal at HH:MM" is that hole after the baseline top-ups of the next section, and it moves only when a site's status changes, not with the gauge.

The planning hour defaults to the **outage hour** — the last site failure inside the horizon, since nothing recovers in the model — not the river peak. Sites starve hours after the roads close, so the network is usually at its worst *after* the water is; at the default gauge the river peaks at +10 h while the last site goes dark at +12 h, and planning for the river peak would find no hole at all. The timeline pins both ("Peak · 8.9 m" and "Outage · 10 of 12 dark"), the button reads "Plan for the outage", and the officer can still pick any hour. During the route wave the fans of the sites the plan loses fade from emerald to grey, staggered by failure hour; survivors' fans stay faintly green. The darker patch left with no fan over it is the hole.

## Site evaluation and the recommendation

Vocabulary, used the same way in the code and on the card: a **site** is one of the existing masts in `terrain.json`; the **portable tower** is the cell-on-wheels driven out from the Kuala Krai depot; the **convoy** is the one genset-and-fuel trailer from the depot; a **top-up** is a crew refuelling a site's generator.

`lib/sites.ts`: a candidate spot for the portable tower is assessed if the route wave reached its road node at today's level and it has at least one **microwave backhaul option** — mast-to-mast line of sight over the DEM (5 m clearance) to a site within `BACKHAUL_RANGE_METRES` = 15 km, nearest first. A mast with nothing to link to is a lamp post. There is no satellite fallback: letting every candidate "fall back to VSAT" would make the surviving network irrelevant to where the portable tower goes.

`lib/recommend.ts` builds the plan in two tiers, because the two kinds of refuel are not the same decision:

- **Tier 1, the baseline top-ups.** Every site the model loses to power whose access is still open for a while (`accessCutHour` > 0: a local crew can still fetch diesel from a fuel source within 25 km by open road) is assumed topped up before that road closes, and stays live through the planned hour. This is routine work the operator's crews do everywhere at once — MCMC's account of the 2014 flood is exactly this, gensets on site and diesel delivered by boat — so it is never ranked against a convoy or a tower. The card shows it as one line ("Local crews top up 5 sites before 22:07 · keeps 22,803"); the people it keeps are counted once, over the union of those sites' coverage; and the **residual hole** — what is left after the top-ups — is the headline "without signal" number of the Site stage.
- **Tier 2, the scarce moves.** Sites no local crew can reach (the west valley: Kuala Balah, Dabong, Jelawang, whose nearest station's road is already cut) can still be reached by the **convoy** — it leaves now at `CONVOY_KMH` = 40 over roads that stay open for the whole drive (open at the highest river level between now and arrival, so a road under water now never "reopens" for the plan when the river dips), and it must be on site before the battery runs out and before the planned hour; the latest such arrival is its "by". Above about 30 m at the gauge no road out of town survives long enough, and the card says so. The **portable tower** needs a microwave link to a site that is live in the plan: a survivor, a topped-up site or the convoy's site. Plans are convoy only, portable tower only, or convoy + portable tower with the mast linked to the convoy's site; each is valued by the people in the residual hole it keeps or brings back on signal at the planned hour, with the hole shrunk by the convoy site's coverage so the tower counts only what it adds. Ranked by that value, then fewer moves, then the shorter road; the card leads with the best and lists up to two alternatives of a different shape. When no convoy can arrive in time and no candidate has a link, the card says so and shows the baseline line alone.

At the default gauge (27.0 m, planned for the outage at +14 h): 36,614 people lose signal; five lowland sites around Manek Urai and Kampung Manjor are topped up locally and keep 22,803; the residual hole is 13,811, almost all of it in the upper Galas valley; the best plan is the convoy to Kuala Balah by +4 h (keeps 7,476) plus the portable tower at Kampung Bukit Bedak linked to Kuala Balah over 10.3 km (reconnects 1,128) — 8,604 on signal. `node scripts/check-sites.mjs [gauge]` prints the baseline, the convoy options, the candidates and the ranked plans.

Simplifications, stated on purpose: a topped-up or convoy-kept site does not revive the sites that hang off it by backhaul; the convoy serves one site; boats are not modelled, so "access closed" is pessimistic; and battery, genset and convoy figures are illustrative until an operator supplies real ones.

## December 2014 hindcast

Kelantan only; the Padas map has no checked event and the sheet says so rather than implying one. The flood everyone remembers is the check. Hindcast mode (the chip beside the clock) loads the ERA5-Land rain from 22 Dec 2014 06Z and sets the gauge to the recorded **34.2 m** peak (JPS Kuala Krai, 24–25 Dec), so the network model and the road graph are read at the peak. `lib/hindcast.ts` compares four reported facts with the model; the Now panel lists them in Hindcast mode and `node scripts/check-hindcast.mjs` prints the same table. The verdicts fall where they fall.

| Reported | Source | Model at 34.2 m | Verdict |
|---|---|---|---|
| Kemubu railway bridge lost | Malaysiakini, 30 Dec 2014 | the 214 m rail bridge over the Galas is cut, from a gauge of 30.1 m | **hit** |
| Kuala Krai cut off by road | FloodList; ANCST post-event report | 2 km of road reachable from the depot (515 km when dry), nothing beyond 0.5 km | **hit** |
| Kampung Kemubu out of contact for days | relief-mission paper, Mediterranean Journal of Social Sciences, 2015 | no modelled site sees Kemubu even before the flood; the nearest, Jelawang (6.5 km) and Dabong (8.2 km), are dark by +8 h | **miss** |
| Maxis and Digi down in Kuala Krai, Celcom up | Malaysiakini / Yahoo News, 26 Dec 2014 (MCMC said the same day that systems were running) | 1 of 2 town sites down at the peak, both dark by +20 h; operators not separable | **partial** |

At the peak the model has 1 site down, 9 on battery and 2 up; 10 of 12 are dark by +8 h and all 12 by +20 h. The town is an island and the network dies with the roads, which is the mechanism the reports describe.

**The miss, plainly.** The site list is capped at twelve corroborated OpenCellID clusters snapped to dry ground; whichever site served Kampung Kemubu in 2014 is not among them, and the viewsheds of the two nearest sites do not reach the village. A model that never gave Kemubu signal cannot show it losing signal. An operator's site list fixes this; no rule was bent to hide it.

**The partial.** OpenCellID clusters carry every network's cells, so the model cannot say "Maxis down, Celcom up". Of the two sites within 4 km of the town, Kuala Krai N is inundated at the peak and Kuala Krai E runs its genset until +20 h.

**Calibration, stated rather than applied.** With the shipped constants, ERA5-Land's 119 mm from 22 Dec lifts the river from danger level to 28.0 m; the record was 34.2 m. Reaching it would need `RUNOFF_COEF` = 0.38, 3.5× the shipped value — and that coefficient would put the Nov 2024 replay at 31.5 m on 29 Nov 08:00, where Bernama reported 25.17 m. One linear coefficient cannot fit both events: ERA5-Land understates the 2014 rain (station totals exceeded 1,000 mm that week) and the stage–discharge relation at Kuala Krai is not linear. The constants stay as they are, the check script prints this arithmetic, and the fix is a JPS rating curve with a unit hydrograph, which the method panel will say.

Sources: [Malaysiakini, 237,000 displaced, 21 dead](https://www.malaysiakini.com/news/284861) · [FloodList, Kelantan flooding worst recorded](https://floodlist.com/asia/malaysia-floods-kelantan-worst-recorded-costs) · [ANCST, The December 2014 flood in Kelantan](https://ancst.org/wp-content/uploads/2016/05/The-December-2014-Flood-in-Kelantan.pdf) · [Kelantan Flood 2014: reflections from a relief-aid mission to Kampung Kemubu](https://www.richtmann.org/journal/index.php/mjss/article/view/6507/6235) · [Kelantan flood victims plead for aid via social media](https://sg.news.yahoo.com/kelantan-flood-victims-plead-aid-via-social-media-023736443.html) · [Malay Mail, MCMC: telecommunication systems still running, 26 Dec 2014](https://www.malaymail.com/amp/news/malaysia/2014/12/26/telecommunication-systems-in-flood-hit-states-still-running-says-mcmc/808867)

## Method sheet

The book icon on the rail opens one sheet that answers "what is real?" in under a minute: four short tables (real data with licence and vintage, the one synthetic input, what is derived and how, every assumed constant with its value and where a real one would come from), a line on seeds, and the December 2014 check with a button that opens the hindcast. `lib/method.ts` builds the tables from the constants the model imports (`RUNOFF_COEF`, `BATTERY_HOURS`, `CONVOY_KMH`, `BACKHAUL_RANGE_METRES` …) and from the selection rules the bake writes into `terrain.json`, so the sheet cannot drift from the code. The gauge mapping lives in `lib/gauge.ts` and is imported by the dashboard, the hindcast and the sheet alike. The rail now has two icons, both alive: the layer panel and the method sheet; the dead Overview, Operator profile, Settings and Sign out icons are gone.

## Moving around

Drag to pan across the terrain. On a trackpad, pinch zooms toward the pointer, a two-finger scroll up or down flies the camera higher or lower, and a two-finger swipe left or right orbits the pivot; with a mouse, the wheel does the same (horizontal wheel orbits) and right-drag or ⌃-drag rotates. Zoom is eased rather than stepped, damping is scaled to the real frame interval so 60 Hz and 120 Hz displays feel the same, the pivot is re-grounded only after a gesture ends, and the render resolution adapts to measured frame times (a little lower during a gesture, full Retina density at rest). The camera drifts slowly once you stop interacting, and holds still under `prefers-reduced-motion`.

## Rebaking the terrain assets

`public/terrain/` and `public/terrain-padas/` are committed so the app runs offline with no API key. To regenerate one:

```bash
npm run bake:terrain             # kelantan, the default
npm run bake:terrain -- padas
npm run bake:terrain -- yenbai       # Vietnam: pulls the VNM WorldPop raster instead of MYS
npm run forecast:scenario -- padas   # its design storm
npm run forecast:scenario -- yenbai
```

The areas of interest, their depots and their drainage thresholds live in the `MAPS` table at the top of `scripts/bake-terrain.mjs`; the runtime half of each entry (gauge, rain inputs, labels) lives in `lib/maps.ts`. Adding a valley means adding to both and running the two commands above. Overpass rate-limits and times out under load, so the bake retries with backoff, and its cache is namespaced per map.

The script downloads its inputs once into `.cache/` (gitignored) and writes `elevation.bin`, `hand.bin`, `houses.bin`, `population.bin`, `roads.json`, `surface.jpg`, and `terrain.json`. `node scripts/check-hole.mjs` prints the hole in people next to the illustrative-house count it replaced.

The forecasts are fetched with Python (`.venv-wx`, gitignored: xarray, zarr, gcsfs, zstandard, numpy, shapely, earthengine-api) and a Google account with WeatherNext access, signed in with `gcloud auth login`; the Earth Engine calls use the same gcloud token with the `resilinet-3d` project. `npm run forecast:live` refreshes the live file (48 leads × 4 statistics, about six minutes the first time, instant from `.cache/weathernext/` after); `npm run forecast:replay` exports the basin and rewrites both replay files. None of this runs in the app.

## Data sources

- Elevation: NASA SRTM 1 arc-second, via the AWS Open Data `elevation-tiles-prod` bucket.
- Imagery: Sentinel-2 cloudless 2020 by EOX IT Services GmbH, CC BY 4.0, based on modified Copernicus Sentinel data 2020.
- Roads, railway, settlements, residential areas and buildings: © OpenStreetMap contributors, ODbL.
- Network sites: OpenStreetMap `man_made=mast` / `communications_tower` / `tower` + `tower:type=communication` (ODbL); OpenCellID cells when `OPENCELLID_KEY` is set in `.env` at bake time (see `.env.example`) (CC BY-SA 4.0 — get a free key at opencellid.org → account → API keys); hand-placed seeds where the map is empty.
- Population: WorldPop 2020 UN-adjusted constrained, 100 m, CC BY 4.0.
- Live forecast: Google DeepMind WeatherNext 3 statistics, `gs://weathernext3_statistics_spatial` (GDM Real-Time Weather Forecasting Experimental Data Terms; CC BY 4.0 for historic data).
- Replay forecast: WeatherNext 2 ensemble-mean archive, Earth Engine `projects/gcp-public-data-weathernext/assets/weathernext_2_0_0_mean`, CC BY 4.0.
- Hindcast: ERA5-Land hourly reanalysis, Earth Engine `ECMWF/ERA5_LAND/HOURLY`, Copernicus C3S licence.
- Basin: HydroBASINS v1 level 9, Earth Engine `WWF/HydroSHEDS/v1/Basins/hybas_9`, HydroSHEDS licence.

## Checks

```bash
npx tsc --noEmit
npx oxlint app components lib scripts
npm run build
node scripts/check-forecast.mjs live        # or replay-2024 / hindcast-2014
node scripts/check-network.mjs 27
node scripts/check-hole.mjs
node scripts/check-hindcast.mjs

# these two take an optional map id first, defaulting to kelantan
node scripts/check-sites.mjs 27
node scripts/check-sites.mjs padas 9.4
node scripts/check-routes.mjs padas 2 3 5
```
