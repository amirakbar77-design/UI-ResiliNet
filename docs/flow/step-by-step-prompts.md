# ResiliNet demo flow — step-by-step prompts

**The story.** It is flooding *now*. The officer enters the river gauge reading and the valley floods on screen. But rain is still falling, so the system flies up to a top-down view and plays the hourly rain forecast over the catchment; a river-level timeline along the bottom shows the predicted river curve over the rain, with the peak hour pinned, while labels at the settlements show how hard it is raining in each place. The officer picks the hour to plan for (default: the peak) and the camera zooms back down into the 3D valley at that hour. One **Start** button then runs the evaluation in two visible phases: first the reachable road network lights up outward from the Kuala Krai depot and stops with a red mark wherever the road is under water; then tower candidates spawn one by one along the lit roads, each pulsing its line-of-sight coverage and counting how many cut-off homes it would reconnect. The best site is highlighted on the map with a compact card. No ranked list, no Accept/Modify/Reject, no decision council.

**Design principles**

- One thing on screen at a time. Each stage shows only the controls that stage needs.
- The map *is* the ranking. If a number matters, it appears next to the thing on the map, not in a table.
- Every number is traceable to data (HAND raster, road graph, homes, forecast grid). Nothing hard-coded.
- The forecast is a simple, transparent model and is labelled *illustrative*. Honest beats impressive.
- Motion has a job: fly-up = "think bigger", fly-down = "now decide", wave = "how far can the truck get".

**Two parts.** Steps 0–9 (done) build the flood story: gauge, forecast, fly-up, route wave, candidates, winner. Part 2, Steps 10–19, puts the *network* in — existing sites, how and when they fail, the coverage hole, a backhaul-aware recommendation, real population, a plan in two tiers, a real ML forecast with an uncertainty band, a 2014 hindcast and a method panel — so the headline number becomes people without signal and the claim is a telecom claim.

**How to use this file.** Paste one step's prompt into Claude Code, let it finish, and run the *You should see* check yourself. If it is not right, redirect with a short follow-up (the *If it's not right* line is the most likely one) before moving to the next step. Every step leaves the app working and `tsc` / lint / build clean, so you can stop after any step.

---

## Step 0 — Strip the panel, add the three-act shell

**Goal:** remove the fake analysis panel and introduce the `Now → Forecast → Site` stages, without touching the 3D.

**Prompt**

```
In components/resilinet-dashboard.tsx, remove everything in InterventionContent that is mock analysis: the "Decision council" RadioGroup and councilOptions, the oversight-log blurb, the CoverageVisual component, the hard-coded "+13,369" reconnected population, the "Dry (0.0m)" and "RM 45,000" MetricCards, and the ACCEPT / MODIFY / REJECT footer with its decision state. Delete now-unused imports and the MetricCard/CoverageVisual components if nothing uses them.

Add a stage state to ResilinetDashboard: `type Stage = 'now' | 'forecast' | 'site'`, default 'now'. Show a step indicator in the TopBar, centred: three chips "1 Now", "2 Forecast", "3 Site". The current chip is highlighted (sky), completed chips are clickable to go back, future chips are dimmed and not clickable. Pass `stage` and `setStage` down; the right-hand panel (desktop) and MobileAnalysis (mobile) render a placeholder per stage: a heading ("Flooding now", "Rain forecast", "Tower site") and one line of muted helper text. Keep the panel's glass styling, close/reopen behaviour and 44 px touch targets.

Do not change components/terrain-3d.tsx or the bake. Run npx tsc --noEmit, npx oxlint components lib scripts, npm run build, and fix anything you introduced.
```

**You should see:** three chips in the top bar with "1 Now" active; the right panel shows only "Flooding now" and a helper line; the 3D scene, layers, timeline and badge still work exactly as before.

**If it's not right:** "Make the chips smaller / move them to the left of the nav links" or "Keep the panel header 'Intervention Analysis' as a small label above the stage heading."

---

## Step 1 — "Now": the observed gauge reading

**Goal:** the officer enters one number — the Kuala Krai gauge reading — and the valley floods live.

**Prompt**

```
Add a `setLevel(metres: number)` method to SceneHandle in components/terrain-3d.tsx that sets the HAND flood threshold directly (call buildFlood/paintRoads/paintHouses with that level and refresh the status spans). Refactor buildFlood, paintRoads and paintHouses to take a level in metres instead of an hour; keep floodLevelForHour in lib/terrain-field.ts only as a helper for the old timeline. Expose a `level` prop on Terrain3D that calls setLevel when it changes.

In the Now stage panel, build an "Observed level" control: label "Kuala Krai gauge", a numeric input and a Slider from 20.0 to 34.0 m in 0.1 steps, default 27.4, with a small reference row "Danger level 25.0 m · Record 2014: 34.2 m" and a live badge "Now · 14:00". Map the gauge reading to the scene's HAND level with `handLevel = clamp(gauge - 25.0, 0.5, 14)` (metres above the drainage datum; document this mapping in a comment as illustrative) and pass it as `level`. A primary button "Forecast →" sets stage to 'forecast'. In the Now stage hide the old HAND timeline panel (TimelinePanel and MobileTimeline) — it belongs to the forecast stage from Step 5 onward.

Run tsc, oxlint, build. Then confirm in the browser that moving the slider floods the valley, turns roads and homes red, and updates the "km cut · km² inundated · homes flooded" badge.
```

**You should see:** a gauge slider in the Now panel; dragging it floods the valley in real time; the badge numbers change; "Forecast →" moves the chip to "2 Forecast" (still a placeholder).

**If it's not right:** "The flood grows too fast / too slow per metre — change the gauge-to-HAND mapping to X" or "Show the depth at Dabong instead of Kuala Krai."

---

## Step 2 — Forecast model and data

**Goal:** an hourly rain forecast on a grid over the valley and a simple, transparent river-level curve that starts from the observed reading.

**Prompt**

```
Create public/forecast.json and lib/forecast.ts.

forecast.json: { source: "illustrative — replace with MET Malaysia / GPM IMERG", issuedAt: "2014-12-23T14:00:00+08:00", station: "Kuala Krai, Sungai Kelantan", aoi: same box as terrain.json, grid: { cols: 16, rows: 14 }, hours: 24, rain: number[24][16*14] } where rain is mm/h per cell per hour. Generate it with a small script scripts/make-forecast.mjs: a convective band that starts over the Gunung Stong massif in the south-west, drifts north-east along the valley over ~10 hours, peaks around hour 6 at ~60 mm/h in its core, then a lighter trailing shower; deterministic seed; row-major with north row first like the terrain grid. Also write catchmentMeanMmPerHour: number[24].

lib/forecast.ts: types Forecast and FloodCurve; loadForecast(url = '/forecast.json'); rainAt(forecast, hour, lon, lat) with bilinear interpolation between cells and linear in time; floodCurve(forecast, observedLevelMetres) implementing a leaky store: each hour level += RUNOFF_COEF * catchmentMean[h] - RECESSION * (level - BASE), clamped to 0.5..14 m, starting from observedLevelMetres at hour 0 (the "now" hour). Expose levels: number[24], levelAt(hour) with interpolation, peakHour() and peakLevel(). Put the constants at the top with one-line comments saying they are illustrative and where a real value would come from (rating curve, unit hydrograph).

Add scripts/check-forecast.mjs that loads both files and prints hour, catchment mm/h, and level for observed=2.4 m, plus the peak hour. Run it. Run tsc and oxlint.
```

**You should see:** `node scripts/check-forecast.mjs` prints 24 rows where the level rises for a few hours *after* the rain peak and then recedes; the peak hour is printed (expect roughly hour 8–10 for a rain peak at 6).

**If it's not right:** "The level should peak later / higher — increase RUNOFF_COEF or lower RECESSION" or "Make the band drift the other way."

---

## Step 3 — Fly up to the overview, fly down to the ground

**Goal:** a smooth camera transition between the 3D oblique and a top-down overview, wired to the stage buttons.

**Prompt**

```
In components/terrain-3d.tsx add `flyTo(view: 'overview' | 'ground')` to SceneHandle. Implement a camera tween (ease-in-out, ~1.2 s, driven from the existing frame loop with dt) between the current camera/target and a destination: for 'overview', the target is the AOI centre on the ground and the camera sits directly above it at a distance that fits the whole tile in view (compute from g.extentX/extentZ and the camera fov), looking straight down; for 'ground', the destination is the existing homePosition/homeTarget. While in overview: lock controls to pan and zoom only (no rotate; minPolarAngle = maxPolarAngle = 0.001), hide the sky gradient and the fog, hide the HTML markers, and lower the directional light so the terrain reads flat like a map. Restore all of that on 'ground'. Under prefers-reduced-motion, cut instantly instead of tweening. Reset view should also restore 'ground' state.

Expose a `view` prop on Terrain3D ('ground' | 'overview') that calls flyTo on change. In the dashboard, "Forecast →" sets stage 'forecast' and view 'overview'; going back to Now sets view 'ground'. Add a temporary "Plan for this hour" button in the Forecast placeholder that sets stage 'site' and view 'ground' (Step 5 replaces it).

Run tsc, oxlint, build; check in the browser that both transitions are smooth and there are no console errors.
```

**You should see:** clicking "Forecast →" lifts the camera to a clean top-down map of the whole valley in about a second; "Plan for this hour" glides back to the oblique.

**If it's not right:** "Fly higher / lower", "Keep a slight tilt in the overview", or "Fade the markers instead of hiding them."

---

## Step 4 — Rain layer in the overview

**Goal:** the forecast becomes visible as rain drifting over the catchment, with the predicted flood underneath.

**Prompt**

```
Add a rain layer to the scene: a plane the size of the AOI, hovering a little above the highest terrain, with a CanvasTexture (e.g. 512×448) redrawn from the forecast grid. Add `setForecast(forecast)` and `setForecastHour(hour: number)` to SceneHandle. For a given (fractional) hour, draw each grid cell as a soft radial gradient whose opacity and colour follow intensity (light drizzle: pale blue, 15 %; heavy: deep blue, 55 %; storm core ≥ 40 mm/h: a violet tint), interpolating between the two nearest hours so scrubbing looks continuous. Only render the plane in the overview view. Underneath it, set the flood level to the forecast curve's level at that hour (the dashboard passes floodCurve levels; the scene should just accept a level via setLevel) so the water grows as the rain passes.

Load /forecast.json in the dashboard once (lib/forecast.ts), compute the curve from the Step 1 gauge reading, and in the forecast stage keep a `forecastHour` state (default = curve.peakHour()). Temporarily drive it with a plain range input in the Forecast placeholder so this step can be checked; Step 5 replaces that input with the river-level timeline.

Run tsc, oxlint, build. Check that the band drifts from the Stong massif north-east along the valley as the hour increases, and that the flood extent grows behind it.
```

**You should see:** in the overview, a soft blue-violet rain band moving across the valley as you drag the temporary hour input; the river flood extent widening a few hours behind the rain.

**If it's not right:** "Make the rain more / less opaque", "Cells look blocky — blur more", or "The rain should move faster."

---

## Step 5 — River-level timeline + rain at the settlements

**Goal:** the forecast control shows the whole river curve at a glance and picks the planning hour; the overview shows how the rain differs across the valley.

*Why not hourly weather cards:* the forecast is a grid — rain over Stong at +2 h, over Kuala Krai at +8 h — so a per-hour card could only show the catchment average, which reads as "the weather here". The map already shows *where* the rain is; what is missing is the *shape* of the river curve (when it peaks, how high) and a clean way to pick the hour. One chart-slider does both honestly.

**Prompt**

```
Build a ForecastTimeline component in components/resilinet-dashboard.tsx for the forecast stage, replacing the temporary range input and readout from Step 4. It is a floating glass panel along the bottom of the map (desktop: between the utility rail and the right panel, same footprint the old HAND timeline used; mobile: above the dock). Its content is one responsive SVG chart (viewBox, width 100%):

- x axis = forecast hours 0…hours-1, labelled with clock times from clockLabel(now, h) every 3 hours, and "Now" at the left edge.
- y axis = river level 0.5–14 m (left, three ticks). Draw curve.levels as a filled area + line in sky; draw forecast.catchmentMeanMmPerHour as faint muted bars from the baseline (secondary scale, label "catchment rain mm/h" once, top-right, small).
- A dashed horizontal line at the gauge-derived floor (gaugeToHandLevel(gauge)) labelled "now".
- A peak pin at curve.peakHour(): a vertical tick and an amber tag "Peak · 9.0 m".
- The chart is the slider: role="slider" on the chart container with aria-valuemin/max/now/valuetext, pointer down + drag or click anywhere sets the hour (snap to 0.25 h), ← / → move 0.25 h (Shift = 1 h), Home / End jump to now / last hour. A small play button steps the hour at 2 h per second and stops at the end. The selected hour shows a vertical cursor line and a readout chip above the chart: "01:37 (+10 h) · 9.0 m · 5.5 mm/h".
- Primary button "Plan for this hour" at the right of the panel calls onNext; when the selected hour equals the peak hour its label is "Plan for the peak".
- Selecting an hour sets chosenHour exactly as the range input did, so the rain layer and flood level keep working.

Per-settlement rain readouts in the overview: today updateMarkers in components/terrain-3d.tsx hides every HTML marker when view !== 'ground'. Change that so settlement ('population') markers stay projected in the overview and only the tower marker is hidden. Add a prop rainByAnchor: Record<string, number> to Terrain3D (mm/h per anchor id at the current forecast hour), computed in the dashboard with rainAt(forecast, forecastHour, lon, lat) from lib/forecast.ts (expose the anchors' lon/lat to the dashboard — e.g. Terrain3D reports its anchors via an onAnchors callback once terrain loads, or compute from terrain.meta.places with the same selection rule as deriveAnchors). In the overview, render each settlement marker in a compact style: name + "42 mm/h", colour-coded (slate <2 mm/h, sky 2–39, violet ≥40); on the ground keep the existing "(N homes)" style. Labels must update as the timeline scrubs.

Site stage: a compact chip near the top of the map, "Planning for 01:37 (+10 h) · 9.0 m", with a "change" link that returns to the forecast stage.

Keep the old TimelinePanel/MobileTimeline only as the fallback when the forecast fails to load (it is already gated on !curve); remove it entirely if you decide the fallback is not worth keeping. Keep everything accessible (44 px targets, focus rings, aria on the slider and play button). Run tsc, oxlint, build; then check in the browser.
```

**You should see:** a chart along the bottom with the level curve rising after the rain bars and falling again, clock times from now, and an amber peak pin; dragging along it moves the rain band and the flood; at the same hour the settlement labels on the overview show *different* mm/h (e.g. Dabong high while Kuala Krai is still light); "Plan for the peak" flies down; the Site stage shows the planning chip.

**If it's not right:** "Make the chart taller / shorter", "Show rain as a line instead of bars", "Fewer time labels", "Hide settlement labels below 1 mm/h", or "Move the readout chip into the right panel."

---

## Step 6 — Road graph, depot and candidate pool (bake)

**Goal:** the data the evaluation needs — a routable road network, the depot, and a pool of possible tower sites.

**Prompt**

```
Extend scripts/bake-terrain.mjs.

1. Road graph: from the same Overpass road and rail queries, build a junction-preserving graph using OSM node ids. Every node that appears in more than one way, or is a way endpoint, is a graph node; between graph nodes keep the intermediate geometry as a polyline but simplify it to ~60 m spacing. Write public/terrain/roads.json: { nodes: [[lon, lat], …], edges: [{ a, b, klass, km, handDm, points: [[lon,lat],…] }] } where handDm is the minimum HAND (decimetres, 255 = dry) sampled along the edge. Keep the existing roads array in terrain.json for drawing, or switch the renderer to draw from roads.json edges if that is simpler — either way the drawn roads and the graph must be the same geometry.

2. Depot: the OSM place node named "Kuala Krai" (town), snapped to the nearest graph node; write depot: { lon, lat, node, name } to terrain.json.

3. Candidates: generalise pickTowerSite into pickCandidates: the best ~30 cells that are 40–350 m above the floodplain datum, HAND ≥ 3 m, within 4 km of a settlement, at least 1 km from each other (greedy by score = height above datum − 0.35·distance to nearest settlement). For each, record lon, lat, elevation, handDm, name (nearest place), roadNode (nearest graph node) and nearestRoadM. Write candidates to terrain.json and keep towerSite = candidates[0] so the current scene keeps working.

Update TerrainMeta in lib/terrain-field.ts (candidates, depot, roads file) and loadTerrain to fetch roads.json. Add scripts/check-routes.mjs: Dijkstra from the depot over roads.json with edges removed when handDm/10 < level, for levels 2, 6 and 10 m; print reachable/blocked and route km per candidate. Run npm run bake:terrain, the check script, tsc, oxlint, build.
```

**You should see:** the bake logs a graph size, a depot at Kuala Krai and ~30 candidates; `check-routes` shows most candidates reachable at 2 m and progressively fewer at 6 and 10 m; the app still loads with the tower on candidate 0.

**If it's not right:** "Candidates cluster on the massif — cap elevation at datum + 250 m", "Too few candidates near Dabong — loosen the settlement radius", or "The depot should be at the KTM station instead."

---

## Step 7 — Start → the route wavefront

**Goal:** press Start and watch how far the truck can get.

**Prompt**

```
In the Site stage panel show a single primary button "Start evaluation" (and a "Skip animation" link once running). Add `evaluateRoutes(level, onProgress)` in a new lib/routing.ts: Dijkstra from the depot over roads.json where an edge is passable only if its handDm is 255 or handDm/10 ≥ level; return per edge the arrival distance (km from the depot) or null if unreachable, plus the set of blocked edges (passable side reached, flooded side not), total reachable km and cut count.

In the scene, add `playRouteWave(result, durationMs)`: animate the road colours so each edge lights up (white → green) when the wavefront reaches its arrival distance (max distance mapped to durationMs ≈ 3 s, eased), leaving unreachable branches dim grey; at each blocked edge draw a small red marker at the water's edge and flash it once. Add a depot marker (HTML marker like the tower marker but with a Warehouse icon and the label "Depot · Kuala Krai"). Respect prefers-reduced-motion by jumping to the final state.

While the wave runs, the status strip shows "Reachable network: 142 km · 9 cuts" updating live. When it settles, keep the lit network on screen and call an `onDone` callback (Step 8 hooks in there). The Start button becomes disabled and reads "Routes evaluated".

Run tsc, oxlint, build; check the wave spreads from Kuala Krai, branches beyond water stay dark, and the numbers match check-routes for the planned level.
```

**You should see:** after Start, the road network lights up outward from the depot marker over about three seconds; roads beyond flooded crossings stay dark with a red mark at the water's edge; the status strip reports reachable km and cuts.

**If it's not right:** "Slower / faster wave", "Show the wave on rail too / not on rail", or "Make blocked crossings a red ✕ instead of a dot."

---

## Step 8 — Candidates spawn around the route

**Goal:** tower sites appear only where the truck can reach, and each shows what it would reconnect.

**Prompt**

```
Extract the viewshed march from buildCoverage in components/terrain-3d.tsx into a reusable `viewshedMask(site, mastMetres, radiusMetres)` in lib/viewshed.ts (or inside terrain-3d.tsx if it needs the scene samplers) that returns a boolean per spoke/ring sample plus a `covers(lon, lat)` test.

After the route wave settles, take the candidates whose roadNode has a finite arrival distance, sorted by that distance, and spawn them one by one (~0.5 s apart, skippable) as small rings beside the lit road: a ring marker grows in, the candidate's coverage fan pulses once (reuse the emerald coverage geometry), and a compact HTML label shows the name and "reaches N cut-off homes", where N = homes whose HAND/10 < planned level (flooded at the planned hour) and that fall inside the viewshed. Compute N with viewshedMask over terrain.houses. Candidates that are unreachable never appear. Keep the evaluation deterministic and log a table of candidate → route km, homes reconnected to the console for checking.

Run tsc, oxlint, build; verify rings appear only along lit roads, in order of distance from the depot, and the labels match the console table.
```

**You should see:** rings popping up one after another along the lit roads, each with a brief coverage pulse and a "reaches N cut-off homes" label; nothing appears on dark (unreachable) roads.

**If it's not right:** "Too many candidates — show the best 8 only", "Pulse is too bright", or "Count all homes covered, not just flooded ones."

---

## Step 9 — Winner and polish

**Goal:** the best site is obvious, the flow restarts cleanly, and it works on a phone.

**Prompt**

```
When all reachable candidates have spawned, pick the winner: highest homes reconnected, tie broken by shorter route km. Glide the camera to it (~1 s), raise the mast and show its coverage fan permanently, and render a compact winner card in the Site panel: name, "+X m above the planned flood", "Y km by road from the depot", "Z homes reconnected", and the planned hour chip. Other candidates keep small muted badges with their number of homes; clicking one previews its coverage without changing the winner. No decision buttons.

Polish: Reset view restarts the whole flow at Now with the gauge reading kept; the Site stage placeholder reads "Press Start to evaluate routes and sites" before Start; mobile: stage chips collapse to "1/3 Now", the forecast timeline and the Site panel work as bottom sheets; prefers-reduced-motion skips all tweens and animations; remove the old HAND timeline code if nothing uses it. Update README.md with the three-act flow, the forecast model and its constants, the road graph, and the evaluation rules. Run tsc, oxlint, build, then do a full run Now → Forecast → Site and confirm no console errors.
```

**You should see:** the winning site highlighted with its coverage, a short card explaining why it won, and a complete run from gauge to winner in under 90 seconds.

**If it's not right:** "Prefer the site closest to the depot when homes are within 10 %", "Show two runners-up in the card", or "Add a 'Send brief' button after all."

---

# Part 2 — Put the network in

Steps 0–9 built a flood story with a telecom label. The number on screen — "cut-off homes" — counts homes under water, which is a hydrology score; a flooded house under a working macro site still has signal. Nothing in the app knows where the existing towers are, so it cannot say a single home has *lost* coverage, cannot say the portable tower adds anything, and assumes "flood ⇒ tower down" when sites actually die from **power loss** (grid out, genset unfuelled because the road is cut) and **backhaul** (fibre on the washed-out bridge, a dark hub). Part 2 fixes the claim without changing the machinery: the flood model, road graph, route wave and viewshed all stay and become *inputs* to a network layer.

**Screen rule for Part 2:** no new panels, no new stages, no new controls. Each act gains one thing inside what is already there — site markers on Now, failure ticks on the Forecast timeline, the hole opening during the Site wave — and the headline number becomes *people without signal*. If a step makes the map feel crowded, hide the thing; do not add a toggle.

**Build order (two months):** Steps 10–13 and 16 in weeks 1–2 (16 is data-only and runs in parallel), 14–15 in week 3, 17–19 in weeks 5–6, then freeze. Weeks 7–8 are rehearsal and deployment; nothing new after week 6.

---

## Step 10 — Existing sites

**Goal:** the map knows where the network is.

**Prompt**

```
Extend scripts/bake-terrain.mjs with a site layer, written to terrain.json as `sites`.

1. Fetch OSM towers in the AOI via the existing overpass() helper: node/way with man_made=mast, man_made=communications_tower, or man_made=tower + tower:type=communication; keep name, height (tower:height or height), and operator when tagged. Fetch OpenCellID cells for the AOI if an API key is present in the environment (OPENCELLID_KEY; document how to get one in the README) and cluster cell positions within 300 m into one site; skip silently if there is no key.

2. Merge and complete: dedupe OSM and OpenCellID within 300 m; if the result has fewer than 8 sites, add hand-placed sites from a small `SITE_SEEDS` table at the top of the script (one per major settlement on high ground beside a road: Kuala Krai town, Kuala Krai bypass, Manek Urai, Kuala Gris, Dabong, Kemubu, Kuala Balah, Jelawang), each flagged `source: 'seed'` so the UI and README can say they are placeholders. Target 8–12 sites total.

3. Per site record: id, name, lon, lat, elevation, handDm, mastMetres (tagged height, else 45 for seeds), source ('osm' | 'opencellid' | 'seed'), power { grid: true, batteryHours: 6, genset: boolean (true for town sites) }, accessNode (nearest road-graph node, like candidates), and backhaul { parent: id | null, kind: 'fibre' | 'microwave' } built by a simple rule: sites within 1 km of the trunk road are 'fibre' with parent = the next fibre site toward Kuala Krai along the road; every other site is 'microwave' with parent = the nearest site that has line of sight to it (use the viewshed march at bake time; fall back to nearest if none), and the Kuala Krai town site is the hub (parent null). Write the rule and the seeds to the README as assumptions.

4. lib/terrain-field.ts: add the Site type and `sites` to TerrainMeta. In components/terrain-3d.tsx add a 'site' anchor kind drawn as a small mast icon marker with a status dot (green by default) and the name; visible on the ground and site views, hidden in the overview. Rename the "Current Tower Status" layer toggle to "Existing sites" and make it control these markers; remove the "New Portable Tower · Place" button from the layer panel (it does nothing).

Run npm run bake:terrain, tsc, oxlint, build; confirm the site markers appear and the layer toggle hides them.
```

**You should see:** 8–12 mast markers across the valley with green dots, mostly near settlements and the trunk road; the layer list reads "Existing sites"; the dead "Place" button is gone.

**If it's not right:** "Too many sites in Kuala Krai town — cluster within 800 m", "Put a seed site at X", or "Show the backhaul parent as a faint dashed line when a site is hovered."

---

## Step 11 — Failure model and status

**Goal:** the app says when and why each site dies — and lets the officer correct it.

**Prompt**

```
Create lib/network.ts with `assessSites(terrain, curve, routeClosingHours, options)` returning per site: status now ('up' | 'battery' | 'down'), failureHour (number | null) and failureCause ('inundation' | 'power' | 'backhaul' | null), computed as the earliest of:

- inundation: first hour h where curve.levelAt(h) > site.handDm / 10 (the cabinet goes under);
- power: the hour the site's access road is cut (from the closing hour of the edge at its accessNode; reuse evaluateRoutes' closingHour, or recompute with lib/routing.ts) plus power.batteryHours; sites with a genset get +12 h (one refuelling); if the access road is already cut now, the site is 'battery' now and fails at now + batteryHours;
- backhaul: the parent's failureHour (recursively; fibre parents along a cut road fail when that road is cut; microwave parents fail when they fail).

Put the constants (BATTERY_HOURS = 6, GENSET_HOURS = 12) at the top with comments saying they are illustrative and that an operator's NOC would supply real runway per site. Add an `overrides: Record<siteId, 'up' | 'battery' | 'down'>` argument so the officer can force a status; an override wins over the model.

UI, Now stage: the site markers' dots follow status (green up, amber battery, red down); tapping a site marker cycles the override (auto → up → battery → down → auto) with a small "manual" tag when overridden — this is how NOC alarms would enter later. Show one line under the gauge: "9 sites · 2 on battery · 0 down" that updates as the gauge moves.

UI, Forecast stage: draw a small tick on the river timeline at each site's failureHour, red for inundation, amber for power, grey for backhaul, and a readout on the selected hour: "by 02:00 · 5 of 9 sites dark". No new chart; ticks sit on the existing SVG.

Add scripts/check-network.mjs that prints the site table (failure hour and cause at the default gauge). Run tsc, oxlint, build; check the ticks and the status dots.
```

**You should see:** most sites green now; as the gauge rises, dots turn amber (access cut, on battery) then red; on the Forecast chart, ticks cluster a few hours after the road closures; tapping a site forces its status.

**If it's not right:** "Battery runway 4 h not 6", "Town sites never lose backhaul (they are the hub)", or "Show the cause in the marker label."

---

## Step 12 — The coverage hole

**Goal:** the headline number becomes people without signal, not homes under water.

**Prompt**

```
In lib/network.ts add `coverageAt(terrain, sites, statusAtHour)` that unions the viewsheds of sites that are up (or on battery) at that hour — reuse viewshedMask with each site's mastMetres and a radius per site kind (9 km macro; use 9 km for all until real data says otherwise) — and returns a covers(lon, lat) test. Define the hole at hour h as homes (Step 14 replaces homes with population) that were covered now and are not covered at h.

Scene: during the Site stage wave, as each site's failureHour is passed by the planned hour, its coverage fan fades from emerald to grey (the fan you already draw; keep the geometry, animate the material colour and opacity). Draw surviving sites' fans faintly. This is the hole: no new layer.

Numbers: replace "reaches N cut-off homes" everywhere with "reconnects N homes without signal" = homes in the hole at the planned hour that the candidate's viewshed covers. The winner card's big number becomes "homes reconnected" with a sub-line "of M without signal at HH:MM". The Site panel readout gains one line: "Without signal at the peak: M homes".

Confirm the number no longer changes when the gauge moves unless a site's status changes. Run tsc, oxlint, build.
```

**You should see:** as the wave plays, one or more site fans go grey and a darker patch of valley is left with no fan over it; the candidates' labels now count homes *in that patch*; a gauge change that fails no site leaves the number alone.

**If it's not right:** "Keep the flooded-homes count as a secondary line", "Grey fans are too visible — drop opacity", or "Use 6 km for village sites."

---

## Step 13 — Re-score the portable site, with backhaul

**Goal:** the recommendation is a telecom recommendation.

**Prompt**

```
Update lib/sites.ts scoring. A candidate is viable only if: reachable now (unchanged), dry at the planned level (unchanged), buildable (unchanged), and it has BACKHAUL — line of sight from its mast height to at least one site that is still up at the planned hour within 15 km (microwave), computed with viewshedMask from the candidate; record backhaulTo (site id) and the distance. Score = homes reconnected (Step 12), tie → shorter route km.

Add a second recommendation type: for each site whose failureCause is 'power' and whose access road is still open now, compute a "keep alive" option — refuelling it before its road closes keeps its whole coverage. Compare the best keep-alive (homes kept) against the best portable site (homes reconnected). The Site panel's recommendation card shows whichever is larger, with the other as the alternative: "Refuel Manek Urai by 22:00 — keeps 1,240 homes on signal" or "Portable tower at Kuala Balah — reconnects 667 homes · backhaul to Kuala Gris (7.2 km, line of sight)". Draw the backhaul as a thin dashed line from the winner's mast to its parent site; draw the keep-alive option as a pulsing outline on that site.

Update scripts/check-routes.mjs (or add check-sites.mjs) to print both option tables. Run tsc, oxlint, build; do a full run.
```

**You should see:** the winner card names its backhaul parent and a dashed line shows it; candidates without any surviving site in view never appear; when refuelling a site would keep more people connected than a new tower, the card says so and the tower is the alternative.

**If it's not right:** "Backhaul range 20 km" or "Always show both options side by side".

---

## Step 14 — Real population

**Goal:** the objective counts people, not invented houses.

**Prompt**

```
Add WorldPop to the bake: download the Malaysia 100 m constrained population GeoTIFF for the AOI (document the URL and licence, CC BY 4.0, in the README; cache it in .cache/), crop to the AOI, resample onto the render grid, and write public/terrain/population.bin (Float32 people per cell) with min/max/total in terrain.json. If the GeoTIFF needs a decoder, use the `geotiff` npm package in the bake script only.

Switch every count in lib/network.ts and lib/sites.ts from houses to population: "people without signal", "people reconnected", "people kept on signal". Keep the houses for the 3D visuals only and label them illustrative in the README; the settlement markers show "~N people" from the population raster within 1.2 km instead of home counts.

Update the winner card and Site panel copy. Run the bake, tsc, oxlint, build; compare the new totals with the old home counts in the console for sanity (expect the same ranking, different magnitudes).
```

**You should see:** the same story with people instead of homes; totals in the thousands; ranking of sites largely unchanged.

**If it's not right:** "Use GHSL instead", "Round people to the nearest 50", or "Show population density as a faint layer in the overview only."

**What happened (commit 8c5d283):** the ranking did change. WorldPop puts three times more people in the lowland around Manek Urai and Kampung Manjor than the illustrative houses did, so a local refuel of one lowland site (13,222 people) outranked the convoy-plus-tower plan (8,604) and the portable tower vanished from the card. That is a flaw in the plan structure, not in the data: Step 15 fixes it.

---

## Step 15 — Baseline top-ups, then the scarce moves

**Goal:** the card decides where the one convoy and the one portable tower go. Routine refuels are assumed, not ranked against them.

**Prompt**

```
Vocabulary first, and use it in code comments, the card and the README: "site" = one of the 12 existing masts in terrain.json; "portable tower" = the cell-on-wheels driven out from the depot; "convoy" = the one genset trailer from the depot; "top-up" = refuelling a site's generator. Stop calling an existing site a tower.

lib/recommend.ts: split keep-alive into two tiers.
- Baseline top-ups: every site whose failureCause is 'power' and whose accessCutHour > 0 (a local crew can still reach a fuel source by open road) is assumed topped up before its access closes and stays live through the planned hour. Return `baseline: { sites, by, peopleKept }` where `by` is the earliest accessCutHour and peopleKept counts people in the hole covered by the UNION of the baseline sites' viewsheds (they overlap; do not sum per site).
- Residual hole: coverageHole with liveAt(plannedHour) ∪ baseline sites. This becomes the headline "Without signal at HH:MM" on the Site panel and the card's "of N" line.
- Scarce moves, ranked over the residual hole only: generator-run options (one convoy) and the portable tower (one unit, microwave link to a site live in the plan, baseline sites included). Plans = convoy only / portable tower only / convoy + portable tower, ranked by people on signal, best plus two alternatives as today. When nothing is feasible (30 m: no convoy arrives in time, no candidate has a link) the card still renders with the baseline line and one sentence: "No convoy or portable tower can reach the valley in time."

Card copy, shorter than today. Delete the ranking-explanation paragraph (it moves to the method panel in Step 18):
  RECOMMENDATION
  Generator run to Kuala Balah + portable tower at Kampung Bukit Bedak
  8,604 people kept on signal · of 13,811 without signal at 07:07
  1  Convoy to Kuala Balah by 21:07
  2  Portable tower at Kampung Bukit Bedak, microwave to Kuala Balah, 10.3 km
  Local crews top up 5 sites before 22:07 · keeps 22,803
  Alternatives: two one-line entries
Site panel: keep the count lines, drop the two helper sentences (under the "Without signal" number and under the candidate tally). No new panels, stages or controls.

Scene: baseline sites keep their status dot green and carry a small "top-up" tag instead of the pulsing ring; the pulsing amber ring stays for the convoy site; the winner mast, fan and dashed backhaul line for the portable tower are unchanged.

scripts/check-sites.mjs prints the baseline sites with their union peopleKept, the residual hole, convoy options, candidates and plans. README: rewrite the recommendation section around the two tiers and the vocabulary. Run tsc, oxlint, build; full headless run at 27, 28 and 30 m.

Expected at 27 m from the scratchpad simulation: baseline 5 sites keep 22,803; residual 13,811; best 8,604 (convoy to Kuala Balah 7,476 + portable tower at Kampung Bukit Bedak 1,128); alternatives 7,476 (convoy only) and 5,141 (convoy to Jelawang + portable tower at Jelawang).
```

**You should see:** at 27 m the headline reads 13,811 without signal; the card's big number is 8,604 with the convoy and the portable tower as the two numbered steps and one line for the 5 top-ups; the mast, fan and dashed line are back on Kampung Bukit Bedak; at 30 m the card says nothing arrives in time.

**If it's not right:** "Show the top-up sites as a list", "Rank portable-tower-only plans first", or "Let the convoy top up two sites in one run."

---

## Step 16 — Real forecasts: WeatherNext 3 live, Nov 2024 replay, Dec 2014 hindcast

**Goal:** no invented rain anywhere. Three dated, sourced inputs run through the same pipeline; the app stays offline.

*What was verified on 14 Sep 2026 (account muhdzaher22@gmail.com, access granted 14 Sep):*
- **WeatherNext 3 statistics** — `gs://weathernext3_statistics_spatial/weathernext_3_0_0_statistics/zarr/2026_to_present/<YYYYMMDD>_<HH>hr_01_preds/predictions.zarr`, Zarr v3, **requester-pays OFF (free)**, one store per init (24/day; 00/06/12/18Z have 360 hourly leads, interim inits 48). Variables `imerg_tp_1hr_{mean,p10,p25,p50,p75,p90}` (IMERG-calibrated) and `total_precipitation_1hr_*`, units **metres per hour**, on the 0.1° grid (`lat_0p1` 1801 × `lon_0p1` 3600, lon 0–359.9), chunked one lead × global (~26 MB per read). The gcloud user token works via `gcsfs.GCSFileSystem(token=google.oauth2.credentials.Credentials(token))`; zarr's store wrapper cannot serialise that credential, so read chunks directly (`<var>/c/<lead>/0/0`, codecs bytes + zstd) as the probe does. Today's 48 h basin total: 2.6 mm mean, 6.6 mm p90 — a dry day, which Live must show honestly.
- **Nov 2024 replay** — Earth Engine `projects/gcp-public-data-weathernext/assets/59572747_4_0` (WeatherNext Gen archive 2020-01 → 2026-07), 6-hourly, ~28 km, `total_precipitation_6hr`; issue `2024-11-27T00:00:00Z` has 40 leads (6…240 h). Units unverified: expand the `tp6h` series once (≈0.01 → metres per 6 h).
- **Dec 2014 hindcast** — Earth Engine `ECMWF/ERA5_LAND/HOURLY`, `total_precipitation_hourly` (metres), 168 images 20–27 Dec 2014, **218 mm basin total** that week.
- **Basin** — HydroBASINS level 9 (`WWF/HydroSHEDS/v1/Basins/hybas_9`) traced upstream from the Kuala Krai gauge (102.199 E, 5.531 N): 37 polygons, **11,500 km²**. Export it once to `public/terrain/basin.geojson` and use it for every basin mean (the tile-mean in the illustrative file was a hydrology error — the river at Kuala Krai answers to the whole upstream basin).

**Prompt**

```
On branch barbar. Python lives in .venv-wx (xarray, zarr, gcsfs, zstandard, numpy already installed; gitignored). Do not add a runtime dependency — everything here runs at bake time and writes JSON the app reads offline.

1. scripts/fetch-weathernext.py, from the working probe: read the newest 6-hourly WeatherNext 3 init (or --init YYYYMMDD_HH), leads 1…48, variables imerg_tp_1hr_{mean,p10,p50,p90}, decoding the Zarr v3 chunks directly through gcsfs with the gcloud access token. Cache each decoded basin/tile window in .cache/weathernext/<init>/<var>_<lead>.npy so re-runs are instant. Basin mean = area-weighted mean of the 0.1° cells inside public/terrain/basin.geojson (export the HydroBASINS polygon once with an Earth Engine snippet in the script's docstring; until then use the bbox 101.4–102.5 E, 4.5–5.7 N). Convert m/h → mm/h. Also cut the 16×14 app grid from the 0.1° field by bilinear interpolation of the mean (≈ 4×3 model cells across the tile — real gradient, not convective detail; flag it as such).

2. Write public/forecast-live.json in the existing shape plus: source "Google DeepMind WeatherNext 3 statistics (experimental), IMERG-calibrated total precipitation, init <ISO>", terms: "GDM Real-Time Weather Forecasting Experimental Data Terms (real-time) / CC BY 4.0 (historic)", basin: { name, areaKm2, source: "HydroBASINS v1 level 9" }, catchmentMeanMmPerHour = mean, catchmentMeanQuantiles: { p10, p50, p90 }, spatial: "0.1° ensemble mean interpolated to the tile". Add npm script forecast:live → .venv-wx/bin/python scripts/fetch-weathernext.py.

3. scripts/fetch-replay.py (Earth Engine Python client; document `earthengine authenticate`): (a) Nov 2024 — issue 2024-11-27T00Z from 59572747_4_0, basin mean of total_precipitation_6hr per lead converted to mm/h and spread evenly over each 6 h step, hours 0…72, written to public/forecast-2024.json with source "WeatherNext Gen archive, issue 2024-11-27 00Z" and a lagged-ensemble band from the four preceding issues (p10/p50/p90 across issues for the same valid hour); (b) Dec 2014 — ERA5-Land hourly basin mean for 2014-12-22T06Z … +72 h written to public/forecast-2014.json with source "ERA5-Land reanalysis (observation-based)", no band. Both files keep the 16×14 rain grid by nearest-cell sampling of the coarse field.

4. lib/forecast.ts: add floodBand(forecast, observed) running the leaky store on p10/p50/p90 when catchmentMeanQuantiles is present; loadForecast(mode) for 'live' | 'replay-2024' | 'hindcast-2014'. Retire scripts/make-forecast.mjs to a fallback only (keep the file, note it in the README).

5. UI: one chip beside the "Now · HH:MM" badge — "Live · WeatherNext 3, init 14 Sep 06Z" / "Replay · 27 Nov 2024" / "Hindcast · 22 Dec 2014" — cycling on tap (this is the only new control in Part 2, and it replaces nothing). The clock follows the mode: Live uses the wall clock; Replay/Hindcast show the event's timestamps, and the gauge prefills to the recorded reading for that event (27.0 m default for Live, the InfoBanjir Kuala Krai reading on 27 Nov 2024 00Z and 22 Dec 2014 06Z — look them up; if unavailable, say "reading not found" and keep the default). The river timeline draws the p10–p90 band as a shaded area under the p50 line; the peak tag reads "Peak · 8.9 m (7.5–10.4)". The Site stage plans for the p50 peak; the winner card's dryness line uses p90.

6. README: the three sources with terms and dates, what WeatherNext 3 gives (hourly, ~10 km IMERG-calibrated ensemble statistics, real spread) and does not (convective cells inside the valley; extremes smoothed), the basin definition, and the sentence "on a dry day Live shows no action — that is the system working". Method panel entry in Step 18.

Run forecast:live, both replay fetches, check-forecast on all three files, tsc, oxlint, build. Commit all three JSON files so the demo runs offline.
```

**You should see:** the mode chip; Live today shows a flat river and "all sites up, no action"; Replay 2024 shows the rain arriving and the curve rising with a shaded band; Hindcast 2014 shows the 218 mm week and the town becoming an island; the forecast source names a real dataset and issue time in every mode.

**If it's not right:** "Plan for the p90 instead", "Band too wide — show p25–p75", "Use total_precipitation instead of the IMERG-calibrated band", or "Cut the live fetch to 24 leads to save time".

---

## Step 17 — 2014 hindcast

**Goal:** the model is checked against the event everyone remembers.

**Prompt**

```
Add a "Hindcast: December 2014" mode reachable from the Method-library rail icon (Step 18 builds the panel; for now a plain toggle). It sets the gauge to the recorded 34.2 m peak, uses a fixed forecast file (public/forecast-2014.json: ERA5 or WeatherNext historic basin rain for 22–25 Dec 2014 if accessible, else the illustrative file with a clear label), and runs the site failure model and route evaluation. Compare with the record and list hits and misses in the panel: Kemubu railway bridge lost (does the graph cut it?), Kuala Krai isolated by road (does the wave stop at the town?), Kampung Kemubu out of contact for five days (is its site dark?), Maxis/Digi down in Kuala Krai (are the town sites dark?). Print the same table with scripts/check-hindcast.mjs. State the misses plainly; do not tune constants to force hits without saying so in the README.
```

**You should see:** a short hits/misses list with the model's answer next to the reported fact; at 34.2 m the town is an island and most sites are dark.

**If it's not right:** "Add the 2024 Nov event too", or "Show the hindcast as a badge on the Now stage instead."

---

## Step 18 — Method panel

**Goal:** every number on screen can be traced before a judge asks.

**Prompt**

```
Build a Method panel behind the "Method library" rail icon (desktop: a wide glass sheet over the map; mobile: full-screen sheet). Sections, each a short table: Real data (SRTM, Sentinel-2, OSM roads/rail/buildings, WorldPop, OpenCellID/OSM sites, WeatherNext) with licence and date; Derived (HAND, viewshed, road graph, route wave) with the algorithm in one line; Assumptions — every constant with its value and where a real one comes from: gauge→HAND mapping, leaky-store constants, embankment allowance, 150 m cut run, slope gate, battery/genset hours, convoy speed, backhaul rule, coverage radius; Seeds — hand-placed sites, flagged. Pull the values from the code (export the constants) so the panel cannot drift from the model. Link the hindcast (Step 17). Remove the remaining dead rail icons (Overview, Operator profile, Settings) or make them no-ops with a tooltip "not in this concept".
```

**You should see:** one panel that answers "what's real?" in under a minute; no dead icons.

---

## Step 19 — Cleanup and rehearsal fixes

**Goal:** nothing on screen that does not earn its place.

**Prompt**

```
Polish pass before the freeze: settlement pins must not overlap site or winner markers (offset or hide the settlement label when a site marker is within 40 px); the tile edge should not show in the site view (raise the camera or clamp the pivot); the Forecast timeline auto-plays from now to the end once when the stage opens, then settles on the p50 peak (respect prefers-reduced-motion); the Site stage camera glides toward the depot on Start; the winner card lists two runners-up in one line each; mobile pass on every stage; README and the memory note updated; tsc, oxlint, build; a full timed run Now → Forecast → Site in under 90 s with no console errors.
```

**You should see:** the same three screens, calmer; the timeline plays itself once; nothing overlaps.

**After Step 19 — freeze.** Deploy the static build, write the three-minute script around one sentence — *this is when your network dies, and what to do about it* — rehearse with a stopwatch, drill the questions (where are the towers, why this site, what is real), and cut anything that does not survive rehearsal.
