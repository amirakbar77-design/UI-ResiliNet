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

The map is a three.js scene built from real data for Yan and Gunung Jerai, Kedah (100.28–100.52 °E, 5.68–5.92 °N):

- **Elevation** — NASA SRTM 1 arc-second (~30 m), rendered as a 432 × 432 mesh at ~62 m spacing with 2.6× vertical exaggeration.
- **Surface** — Sentinel-2 cloudless imagery draped as a 2048² mercator texture, with per-vertex UVs computed from longitude/latitude.
- **Flood layer** — a real HAND (Height Above Nearest Drainage) raster, computed at bake time by priority-flood sink filling, a D8 drainage tree, flow accumulation, and a downstream walk to the nearest channel. The scenario slider sets the HAND threshold in metres, and the water sheet sits on the drainage datum plus that level.
- **Roads** — OpenStreetMap ways, draped on the terrain and coloured by inundation at the current scenario hour. The badge reports kilometres cut and area inundated, both recomputed from the raster as the slider moves.
- **Coverage** — a line-of-sight viewshed marched outward from the tower mast over the real elevation grid, so ridges genuinely shadow it.
- **Tower candidate** — the highest ground within 6 km of the settled plain that stays dry at every modelled level, named after its nearest OSM settlement.

Drag to orbit, scroll to zoom; the camera drifts slowly once you stop interacting, and holds still under `prefers-reduced-motion`.

## Rebaking the terrain assets

`public/terrain/` is committed so the app runs offline with no API key. To regenerate it:

```bash
npm run bake:terrain
```

The script downloads its inputs once into `.cache/` (gitignored) and writes `elevation.bin`, `hand.bin`, `surface.jpg`, and `terrain.json`.

## Data sources

- Elevation: NASA SRTM 1 arc-second, via the AWS Open Data `elevation-tiles-prod` bucket.
- Imagery: Sentinel-2 cloudless 2020 by EOX IT Services GmbH, CC BY 4.0, based on modified Copernicus Sentinel data 2020.
- Roads and settlements: © OpenStreetMap contributors, ODbL.

## Checks

```bash
npx tsc --noEmit
npx oxlint app components lib scripts
npm run build
```
