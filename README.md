# ResiliNet 3D UI Concept

An isolated, frontend-only interface prototype for the ResiliNet 3D disaster-response dashboard.

This project contains static mock data and local presentation state only. It does not import from or modify the working ResiliNet application, and it contains no backend, analysis pipeline, persistence, or operational data.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The terrain is a procedural three.js model rendered in the browser: no map
token, tile service, or DEM download is involved. Drag to orbit, scroll to
zoom; the camera drifts slowly on its own once you stop interacting. The
scenario slider drives the HAND flood surface, and the map-layer switches
toggle the flood, road, coverage, and marker layers in the 3D scene.

## Checks

```bash
npx tsc --noEmit
npx oxlint app components lib
npm run build
```
