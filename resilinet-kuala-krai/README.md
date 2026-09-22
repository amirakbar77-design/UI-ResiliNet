# ResiliNet 3D — Kuala Krai simulation

A standalone adaptation of the exact four-act landing simulation supplied by the user:
https://github.com/CoEdd/resilinet-3d-geo-ai-simulator

Based on upstream commit `16d63785fbbe25dea38c205a21a1dede5d979f7a`.
The original renderer, scene materials, buildings, counters, placement animation, timeline, typography and UI are retained. The coastal scene is adapted to a winding river and tributary, and its narrative/location is Kuala Krai, Kelantan.

## Run

Requires Node.js 22.13+.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3002.

```sh
npm run build  # TypeScript check and production build
npm test      # timeline/counter and response-accounting tests
npm run preview -- --host 127.0.0.1 --port 3002
```

Copy this folder to its own repository to use it independently. It has no imports from the existing ResiliNet full app or the earlier little-world demo.

## Prototype link

The top-right button opens the existing Kuala Krai working app at `http://localhost:3000/explore`. That app must be running separately. For deployment, set `VITE_PROTOTYPE_URL` to its public URL in `.env.local` before building; see `.env.example`.

## What is real and what is illustrative

The terrain, buildings, routes and 1.4 m visual scenario dial remain illustrative. The **population counters now use the full application's Kuala Krai model**, verified with `node scripts/check-sites.mjs kelantan 27`: initial gauge 27.0 m, planning hour +14 h.

| Model result | People |
| --- | ---: |
| Initially in covered areas | 80,368 |
| Without support: projected cut off | 36,614 |
| Kept connected by routine support | 22,803 |
| Remaining at risk after routine support (demo denominator) | 13,811 |
| Additional generator support at Kuala Balah | 7,476 |
| Portable tower at Kampung Bukit Bedak | 1,128 |
| Additional combined response: kept on signal (demo headline) | 8,604 |
| Total kept or brought back online | 31,407 |
| Still without coverage | 5,207 |

The demo headline is **8,604 of 13,811 kept on signal**, after routine support. The 31,407 total includes routine support and is retained here for reconciliation, not displayed as the response headline.

These are modelled population coverage estimates, not measured subscribers or confirmed field outcomes. The animated counter ramps are presentation transitions, not time-series model output. The snapshot is embedded so this project can run independently; rerun the source check if model inputs change. The illustrated tower alone must not be credited with the total combined benefit.

## Controls

Autoplays and loops in 34.5 seconds. Select acts 1–4, pause/play, press Space to pause, drag to orbit, or scroll to zoom. Reduced-motion preference opens the final state paused.

## Source attribution

Adapted from CoEdd/resilinet-3d-geo-ai-simulator at the user's request. Original source comments and inherited tests are preserved. The upstream checkout is retained in the parent workspace's `.openai/reference-simulator` for comparison. Upstream did not include a LICENSE file at the referenced commit; this adaptation does not assert a new license over its code.
