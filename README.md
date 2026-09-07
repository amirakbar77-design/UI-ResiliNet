# ResiliNet 3D UI Concept

An isolated, frontend-only interface prototype for the ResiliNet 3D disaster-response dashboard.

This project contains static mock data and local presentation state only. It does not import from or modify the working ResiliNet application, and it contains no backend, analysis pipeline, persistence, or operational data.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The dashboard includes an offline illustrated terrain view by default. To try the optional Mapbox 3D terrain, copy `.env.example` to `.env.local` and add a public Mapbox token.

## Checks

```bash
npx tsc --noEmit
npx oxlint app/page.tsx app/layout.tsx components/resilinet-dashboard.tsx components/live-terrain-map.tsx
npm run build
```
