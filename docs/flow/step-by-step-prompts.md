# ResiliNet demo flow — step-by-step prompts

**The story.** It is flooding *now*. The officer enters the river gauge reading and the valley floods on screen. But rain is still falling, so the system flies up to a top-down view and plays the hourly rain forecast over the catchment; a river-level timeline along the bottom shows the predicted river curve over the rain, with the peak hour pinned, while labels at the settlements show how hard it is raining in each place. The officer picks the hour to plan for (default: the peak) and the camera zooms back down into the 3D valley at that hour. One **Start** button then runs the evaluation in two visible phases: first the reachable road network lights up outward from the Kuala Krai depot and stops with a red mark wherever the road is under water; then tower candidates spawn one by one along the lit roads, each pulsing its line-of-sight coverage and counting how many cut-off homes it would reconnect. The best site is highlighted on the map with a compact card. No ranked list, no Accept/Modify/Reject, no decision council.

**Design principles**

- One thing on screen at a time. Each stage shows only the controls that stage needs.
- The map *is* the ranking. If a number matters, it appears next to the thing on the map, not in a table.
- Every number is traceable to data (HAND raster, road graph, homes, forecast grid). Nothing hard-coded.
- The forecast is a simple, transparent model and is labelled *illustrative*. Honest beats impressive.
- Motion has a job: fly-up = "think bigger", fly-down = "now decide", wave = "how far can the truck get".

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
