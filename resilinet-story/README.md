# ResiliNet / little world

A standalone 3D explanation of ResiliNet for a nontechnical audience. It uses a fictional miniature village to show why a flood can disconnect dry homes, and how a reachable portable tower linked to a working network can help.

## Run independently

Requires Node.js 22.13+.

```sh
cd resilinet-story
npm install
npm run dev
```

Open http://localhost:3001. Build with `npm run build`; preview with `npm run preview`.

This folder can be copied into its own repository. It depends only on Three.js and Vite, and imports no full-app code, data, assets or services.

## Story

Four ten-second chapters autoplay and loop: connected village → flood and loss of power → reachable location → portable tower and restored connection. Pause, replay, chapter selection and drag-to-orbit are supported. Reduced-motion preference starts playback paused. Hidden tabs stop advancing.

The eight homes, landscape, routes and timing are illustrative, not an operational forecast or quantified impact claim. Decorative trees are not real vegetation data. The safe southern route is an elevated causeway. No backend, external fonts, remote map or API key is required.
