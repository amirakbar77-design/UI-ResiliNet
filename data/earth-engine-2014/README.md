# December 2014 flood: observed extent vs the ResiliNet flood model

Kuala Krai–Dabong AOI (101.88–102.28 E, 5.26–5.60 N). The question: at the recorded peak of the December 2014 flood, how much of the real flood does the app's flood model reproduce?

## What the model is

`hand.bin` from the bake: height above the nearest drainage cell on a 62 m grid, from NASA SRTM. The app floods every cell whose HAND is below the level. The level comes from the Kuala Krai gauge: metres above the 25.0 m danger level, one for one. At the 2014 record of **34.2 m** that is **HAND < 9.2 m**, one water level for the whole valley.

## What the observation is

No satellite saw this valley during the event:

- Sentinel-1: first scene over the AOI is 4 March 2015.
- Landsat 8: nearest scene 6 January 2015, 6.7 % clear over the AOI.
- MODIS (Global Flood Database event DFO 4216, 20 Dec 2014 – 1 Jan 2015, 215,000 displaced): 1 % clear views over the whole of Kelantan; 0 km² flooded detected in the AOI.

The observed extent therefore comes from the published DID/UMT flood maps in **Sathiamurthy et al., "Kelantan central basin flood, December 2014: causes and extent", Bulletin of the Geological Society of Malaysia 68 (2019)** (`https://gsm.org.my/wp-content/uploads/gsm_file_2/702001-101811-PDF.pdf`). Their maps interpolate the recorded peak stages between DID stations along the rivers and subtract a LiDAR ground model. Peaks used there: Kuala Krai 34.17 m NGVD on 25 Dec 15:00, Dabong 45.89 m on 24 Dec 12:00. These are record-based reconstructions, not photographs of water, and they are the best reference that exists for this valley.

Four figures were digitised (blue flood classes by colour threshold) and registered:

| Frame | Figure | Scale | Registered on |
|---|---|---|---|
| whole valley | Fig. 5, upper and central basin | ~360 m/px | the river network: 94 % of the digitised flood lies on the DEM drainage after fitting scale, rotation and shift |
| Kuala Krai town | Fig. 8 | 3.5 m/px (500 m bar = 144 px) | three lettered landmarks: hospital, railway station, vocational college (mean residual 113 m) |
| Dabong | Fig. 7 left | 5.7 m/px | river channel against OSM river lines (34 % channel match) |
| Manik Urai | Fig. 7 middle | 6.4 m/px | river channel against OSM river lines (21 % channel match) |

## Result at the 2014 peak (gauge 34.2 m)

| Frame | IoU | precision | recall | observed km² | model km² |
|---|---|---|---|---|---|
| whole valley | 0.29 | 0.38 | 0.54 | 168 | 235 |
| main-river corridor, 2.5 km | 0.39 | 0.60 | 0.53 | 141 | 125 |
| Kuala Krai town | 0.52 | 0.63 | 0.75 | 7.0 | 8.3 |
| Dabong | 0.55 | 0.88 | 0.60 | 2.9 | 1.9 |
| Manik Urai | 0.49 | 0.92 | 0.52 | 4.6 | 2.6 |

IoU = flooded in both ÷ flooded in either. Precision = share of the model's flood that was really flooded. Recall = share of the real flood the model caught.

## What it says

- In the towns, where the reference map is fine enough to trust, the model reproduces half to two thirds of the flooded ground and is right 63–92 % of the time where it says flood. Kuala Krai, the town the app plans for, scores best on recall (75 %).
- The model **under-floods the main-river floodplain** (Dabong and Manik Urai recall 52–60 %, model area smaller than observed) and **over-floods the tributaries** (whole-valley precision 38 %). One HAND level for the whole valley cannot do both: the real 2014 water was much deeper along the Galas and Lebir than up the side streams. A level that rises with distance down the trunk rivers, or a proper rating curve per reach, is the fix, and it is listed in the app's method panel as an assumption to replace.
- Part of the whole-valley "model only" area is the reference map's resolution, not a model error: the basin map was interpolated along the trunk rivers only and draws nothing on the tributaries.
- The best-matching single level is higher than 9.2 m in every frame (12.5–13.5 m). The gauge-to-level mapping (one metre of gauge = one metre of HAND) is conservative for this event.

## Files

- `validation_2014_summary.png` — one page: four overlap panels and the legend.
- `validation_2014_basin.png`, `validation_2014_kualakrai.png`, `validation_2014_dabong.png`, `validation_2014_manikurai.png` — observed, model and overlap for each frame.
- `validation_2014_fig5_metrics.json`, `validation_2014_towns_metrics.json` — the numbers above plus the level sweep 1–14 m.
- `fig5_registration.json`, `observed_2014_fig5_on_grid.npy`, `town_*_masks.npz` — the registered observed masks.
- `model_flood_gauge34p2_hand9p2m.tif` — the model flood raster (EPSG:4326).
- `panels/` — the digitised town panels.
- `gfd_dfo4216_*`, `landsat8_20150106_*` — the satellite checks that came back empty, kept as evidence.
- `osm_ref.json` — OSM rivers, water bodies, rail and main roads used for registration.
- `earth-engine-kelantan-2014.js` — the original Code Editor script (Sentinel-1 workflow); it has no data to work on for 2014 and is kept for the 2024 folder's method.

Copies of the five figures are in `docs/pitch/validation/`.
