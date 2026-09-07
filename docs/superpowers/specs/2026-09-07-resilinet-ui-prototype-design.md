# ResiliNet 3D UI Prototype Design

## Purpose

Create a high-fidelity, frontend-only redesign concept for ResiliNet 3D that a teammate can review independently of the working application.

The prototype is an isolated visual shell. It must not modify, import from, or depend on `/Users/amir/GeoAI_Hackathon/resilinet-3d-geo-ai-simulator-main`.

## Delivery location

The finished project will live at:

`/Users/amir/GeoAI_Hackathon/resilinet-3d-ui-concept`

Development may be staged in the writable Codex workspace before the finished standalone folder is copied to that location. The original ResiliNet directory remains read-only throughout.

## Product scope

The prototype contains one full-screen dashboard route for an emergency communications officer evaluating a portable-tower intervention around Yan and Gunung Jerai, Kedah.

It includes:

- a stylized 3D terrain background;
- a top application bar and narrow utility sidebar;
- a floating location and map-layer control;
- a HAND flood-depth legend and scenario timeline;
- an intervention-analysis panel with metrics, a line-of-sight illustration, council options, an oversight note, and decision buttons;
- static flood, damaged-road, population, and tower overlays;
- responsive desktop and mobile layouts; and
- lightweight local interactions that make the shell feel reviewable.

It excludes:

- backend services, databases, authentication, persistence, analytics, or telemetry;
- data fetching, geospatial analysis, scoring, routing, or coverage calculations;
- integration with the existing ResiliNet application; and
- claims that any mock value is a computed or live result.

## Technical architecture

Use a standalone Next.js App Router application with React, TypeScript, Tailwind CSS, `lucide-react`, and `react-map-gl`.

The page is componentized into focused presentation units:

- `TopBar` for product identity and navigation;
- `UtilityRail` for primary tool icons;
- `TerrainStage` for Mapbox or its visual fallback plus static overlays;
- `LayerPanel` for local layer-toggle state;
- `TimelinePanel` for the static HAND legend and scenario step;
- `InterventionPanel` for analysis content and decision controls; and
- small reusable UI primitives for icons, badges, buttons, and labels where repetition warrants them.

All state remains in the browser and resets on refresh. No component calls an API.

## Map strategy

Use `react-map-gl` with a clean vector Mapbox style and terrain configuration when `NEXT_PUBLIC_MAPBOX_TOKEN` is available.

When no token is configured, render a deliberate illustrated terrain fallback rather than an empty map. The fallback uses layered SVG/CSS topography, water channels, road damage, population markers, and the tower marker. It preserves the intended visual hierarchy and makes the prototype reviewable offline.

The map is a presentation surface only. The prototype does not request ResiliNet data or perform map analysis.

## Visual direction

The design is a dark emergency-operations console floating above a simplified green terrain model. Slate glass panels carry controls and evidence, while color is reserved for meaning:

- blue and cyan for water and map context;
- green for restored connectivity and acceptance;
- red for severed access and rejection; and
- amber for caution or incomplete evidence.

The first viewport is the dashboard itself, not a marketing page. Controls use restrained blur, fine borders, compact radii, clear type hierarchy, and sufficient contrast. The terrain remains the largest visual element.

Typography uses a local/system sans-serif stack to avoid a runtime font request. Body copy is at least 16px where reading density allows, with 14px reserved for compact operational labels.

## Layout and responsive behavior

### Desktop

- The 56px top bar spans the viewport.
- The 56px utility rail begins below the top bar.
- Location and layer controls float near the upper-left of the map.
- The HAND legend and timeline sit at the lower-left.
- The intervention panel occupies a fixed-width column on the right and scrolls internally if needed.
- Map overlays remain visible in the central unobstructed stage.

### Mobile and narrow screens

- The utility rail becomes a bottom tool dock.
- Secondary top-navigation links collapse behind a menu control.
- The location/layer panel becomes a compact upper sheet.
- The intervention panel becomes a lower sheet that can be collapsed and reopened.
- The timeline remains reachable without covering the primary intervention metrics.
- All interactive targets are at least 44px in their smallest touch dimension.

## Interaction model

Interactions are local and illustrative:

- layer rows toggle their highlighted state and the visibility of corresponding mock overlays;
- the timeline play control changes its visual state, while the scrubber selects among labelled mock hours;
- decision-council radio options can be selected;
- the analysis panel can be closed and reopened;
- Accept, Modify, and Reject produce an inline confirmation state only; and
- navigation icons and links provide hover, focus, and active feedback without routing to invented pages.

No interaction changes a real scenario or stores a decision.

## Content and data labels

Use the labels and example values supplied in the brief, including:

- Yan and Gunung Jerai, Kedah, Malaysia;
- reconnected population `+13,369`;
- site flood depth `Dry (0.0m)`;
- estimated cost `RM 45,000`;
- population labels such as `(N=420)` and `(N=137)`; and
- `Kg. Merbok` with `Elevation: 65m`.

Add a concise `STATIC UI CONCEPT` indicator so reviewers do not mistake mock values for live or computed information.

## Accessibility

- Use semantic buttons, navigation landmarks, headings, and radio controls.
- Provide visible focus states and descriptive `aria-label` text for icon-only controls.
- Never rely on color alone for selected, damaged, or accepted states.
- Respect `prefers-reduced-motion`.
- Preserve readable contrast over both the live map and the illustrated fallback.

## Error and empty states

- A missing Mapbox token selects the illustrated terrain fallback automatically; it is not presented as an error.
- If the map runtime cannot initialize, the same fallback remains visible.
- Closed panels always have an obvious, keyboard-accessible way to reopen them.
- No loading spinner implies that analysis is being performed.

## Verification

Before delivery:

- install dependencies and run the production build;
- confirm no source file references the original ResiliNet directory;
- confirm no application code contains fetch requests, server actions, database clients, or persistence;
- inspect the dashboard at a desktop viewport and a narrow mobile viewport;
- check keyboard access for panel controls, layer toggles, timeline, council options, and decision buttons; and
- confirm that the illustrated fallback renders without a Mapbox token.

## Acceptance criteria

The work is complete when the separate project builds successfully, presents the full requested dashboard on first load, remains useful without a Mapbox token, responds cleanly at desktop and mobile sizes, and contains no real ResiliNet logic or modifications to the original project.
