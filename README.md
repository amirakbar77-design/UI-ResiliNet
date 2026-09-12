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
- **Flood layer** — a real HAND (Height Above Nearest Drainage) raster, computed at bake time by priority-flood sink filling, a D8 drainage tree, flow accumulation, and a downstream walk to the nearest channel. The scenario slider sets the HAND threshold from 0.5 m to 14 m, and the water sheet sits on the drainage datum plus that level.
- **Roads and railway** — OpenStreetMap highway ways and the KTM East Coast line, draped on the terrain and coloured by inundation at the current scenario hour. The badge reports kilometres cut and area inundated, both recomputed from the raster as the slider moves.
- **Homes** — OSM building footprints where they exist; elsewhere illustrative houses fill OSM residential areas (one per 0.15 ha) and cluster around OSM settlement nodes, so each kampung reads as a community. Homes are drawn about three times their true footprint for legibility and turn red once the flood reaches them; the badge counts them and each settlement marker shows the number of homes within 1.2 km — an indication of scale, not a census.
- **Coverage** — a line-of-sight viewshed marched outward from the tower mast over the real elevation grid, so ridges genuinely shadow it.
- **Tower candidate** — the highest ground 40–350 m above the floodplain datum, within 6 km of an OSM settlement, that stays dry at every modelled level; named after its nearest settlement.

Sources for the scenario narrative: [2014–15 Malaysia floods](https://en.wikipedia.org/wiki/2014%E2%80%9315_Malaysia_floods), [FloodList](https://floodlist.com/asia/malaysia-floods-kelantan-worst-recorded-costs), [Macaranga on Dabong](https://www.macaranga.org/embed/forestsgone_202301/floodkelantan.html), [The Star, 28 Nov 2024](https://www.thestar.com.my/news/nation/2024/11/28/seven-transmitter-stations-42-internet-hubs-in-kelantan-terengganu-hit-by-floods).

Drag to pan across the terrain. On a trackpad, pinch zooms toward the pointer, a two-finger scroll up or down flies the camera higher or lower, and a two-finger swipe left or right orbits the pivot; with a mouse, the wheel does the same (horizontal wheel orbits) and right-drag or ⌃-drag rotates. Zoom is eased rather than stepped, damping is scaled to the real frame interval so 60 Hz and 120 Hz displays feel the same, the pivot is re-grounded only after a gesture ends, and the render resolution adapts to measured frame times (a little lower during a gesture, full Retina density at rest). The camera drifts slowly once you stop interacting, and holds still under `prefers-reduced-motion`.

## Rebaking the terrain assets

`public/terrain/` is committed so the app runs offline with no API key. To regenerate it:

```bash
npm run bake:terrain
```

The script downloads its inputs once into `.cache/` (gitignored) and writes `elevation.bin`, `hand.bin`, `houses.bin`, `surface.jpg`, and `terrain.json`.

## Data sources

- Elevation: NASA SRTM 1 arc-second, via the AWS Open Data `elevation-tiles-prod` bucket.
- Imagery: Sentinel-2 cloudless 2020 by EOX IT Services GmbH, CC BY 4.0, based on modified Copernicus Sentinel data 2020.
- Roads, railway, settlements, residential areas and buildings: © OpenStreetMap contributors, ODbL.

## Checks

```bash
npx tsc --noEmit
npx oxlint app components lib scripts
npm run build
```
