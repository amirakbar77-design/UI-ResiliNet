#!/usr/bin/env python
"""
Earth Engine fetches for the dated forecasts the app replays offline, plus
the basin polygon every basin mean uses.

    .venv-wx/bin/python scripts/fetch-replay.py --export-basin
    .venv-wx/bin/python scripts/fetch-replay.py --replay-2024
    .venv-wx/bin/python scripts/fetch-replay.py --hindcast-2014
    .venv-wx/bin/python scripts/fetch-replay.py --all
    npm run forecast:replay

Basin: HydroBASINS v1 level 9 (WWF/HydroSHEDS/v1/Basins/hybas_9) traced
upstream from the Kuala Krai gauge (102.199 E, 5.531 N) by following NEXT_DOWN,
dissolved and written to public/terrain/basin.geojson. The river at Kuala Krai
answers to this whole basin, not to the render tile.

Replay, Nov 2024: projects/gcp-public-data-weathernext/assets/weathernext_2_0_0_mean
(WeatherNext 2 ensemble-mean archive, 6-hourly leads, ~28 km, total_precipitation_6hr
in metres per 6 h, 2022-01 onward). It supersedes the WeatherNext Graph asset
59572747_4_0 that Earth Engine now marks deprecated; pass --asset to use that
one instead. Issue 2024-11-27 00Z, hours 0..72, plus a lagged-ensemble band
(p10/p50/p90 across this issue and the preceding ones for the same valid hour).

Hindcast, Dec 2014: ECMWF/ERA5_LAND/HOURLY total_precipitation_hourly
(metres), 2014-12-22 06Z + 72 h, no band (reanalysis, observation-based).

Auth: the gcloud user token (`gcloud auth login`) with project resilinet-3d,
which has the Earth Engine API enabled; `earthengine authenticate` works too.
Bake-time only: the app reads the JSON offline.
"""

import argparse
import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import ee
import numpy as np
from google.oauth2.credentials import Credentials

ROOT = Path(__file__).resolve().parents[1]
TERRAIN = ROOT / 'public' / 'terrain' / 'terrain.json'
BASIN = ROOT / 'public' / 'terrain' / 'basin.geojson'
OUT_2024 = ROOT / 'public' / 'forecast-2024.json'
OUT_2014 = ROOT / 'public' / 'forecast-2014.json'
PROJECT = 'resilinet-3d'
GAUGE = (102.199, 5.531)
GRID_COLS, GRID_ROWS = 16, 14
HOURS = 73  # hour 0 = issue time, through +72 h

WX_ASSET = 'projects/gcp-public-data-weathernext/assets/weathernext_2_0_0_mean'
WX_LABEL = 'WeatherNext 2 ensemble-mean archive (Earth Engine asset weathernext_2_0_0_mean, 6-hourly, ~28 km)'
WX_SCALE_M = 27830
ISSUE_2024 = datetime(2024, 11, 27, 0, tzinfo=timezone.utc)
LAGGED_ISSUES = [ISSUE_2024 - timedelta(hours=6 * k) for k in range(4, 0, -1)]  # 26 Nov 00Z .. 18Z
ERA_SCALE_M = 11132
START_2014 = datetime(2014, 12, 22, 6, tzinfo=timezone.utc)


def log(*parts):
    print('[replay]', *parts, flush=True)


def init_ee():
    token = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True, check=True).stdout.strip()
    ee.Initialize(credentials=Credentials(token), project=PROJECT)


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


# --- Basin -------------------------------------------------------------------

def export_basin():
    hb = ee.FeatureCollection('WWF/HydroSHEDS/v1/Basins/hybas_9')
    point = ee.Geometry.Point(list(GAUGE))
    seed = ee.Feature(hb.filterBounds(point).first())
    ids = [seed.get('HYBAS_ID').getInfo()]
    frontier = list(ids)
    while frontier:
        ups = hb.filter(ee.Filter.inList('NEXT_DOWN', frontier)).aggregate_array('HYBAS_ID').getInfo()
        frontier = [i for i in ups if i not in ids]
        ids.extend(frontier)
    basin = hb.filter(ee.Filter.inList('HYBAS_ID', ids))
    area = round(basin.aggregate_sum('SUB_AREA').getInfo())
    geometry = basin.union(maxError=50).geometry().simplify(maxError=150).getInfo()
    feature = {
        'type': 'Feature',
        'geometry': geometry,
        'properties': {
            'name': 'Sungai Kelantan above Kuala Krai',
            'areaKm2': area,
            'polygons': len(ids),
            'gauge': list(GAUGE),
            'source': 'HydroBASINS v1 level 9 (WWF/HydroSHEDS/v1/Basins/hybas_9), traced upstream from the Kuala Krai gauge; dissolved and simplified to 150 m',
            'licence': 'HydroSHEDS licence (free for any use with attribution)',
        },
    }
    BASIN.write_text(json.dumps({'type': 'FeatureCollection', 'features': [feature]}, separators=(',', ':')))
    log(f'basin: {len(ids)} polygons, {area} km2 -> {BASIN.relative_to(ROOT)} ({BASIN.stat().st_size // 1024} kB)')


def basin_geometry():
    if not BASIN.exists():
        export_basin()
    geo = json.loads(BASIN.read_text())
    feature = geo['features'][0]
    return ee.Geometry(feature['geometry']), feature['properties']


# --- Shared -----------------------------------------------------------------

def app_grid():
    """Cell-centre points of the 16x14 app grid, row-major with the north row first."""
    aoi = json.loads(TERRAIN.read_text())['aoi']
    features = []
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            lat = aoi['north'] - (r + 0.5) * (aoi['north'] - aoi['south']) / GRID_ROWS
            lon = aoi['west'] + (c + 0.5) * (aoi['east'] - aoi['west']) / GRID_COLS
            features.append(ee.Feature(ee.Geometry.Point([lon, lat]), {'cell': r * GRID_COLS + c}))
    return aoi, ee.FeatureCollection(features)


def band_series(image, band_names, geometry, scale):
    """Basin mean of every band of a stacked image, in the image's units."""
    values = image.reduceRegion(ee.Reducer.mean(), geometry, scale=scale, bestEffort=True, maxPixels=1e9).getInfo()
    return [float(values[b]) for b in band_names]


def grid_samples(image, band_names, points, scale):
    """Nearest-cell value of every band at every app-grid point: list[band][cell]."""
    sampled = image.reduceRegions(points, ee.Reducer.first(), scale=scale).getInfo()['features']
    by_cell = {f['properties']['cell']: f['properties'] for f in sampled}
    return [[float(by_cell[i].get(b) or 0.0) for i in range(GRID_COLS * GRID_ROWS)] for b in band_names]


def write(path, payload):
    path.write_text(json.dumps(payload, separators=(',', ':')))
    log('wrote', path.relative_to(ROOT), f'({path.stat().st_size // 1024} kB)')


# --- Nov 2024 replay ---------------------------------------------------------

def wx_issue_leads(issue, max_hour):
    """Sorted leads of one WeatherNext Graph issue, as (forecast_hour, image)."""
    coll = ee.ImageCollection(WX_ASSET).filterDate(iso(issue), iso(issue + timedelta(seconds=1)))
    hours = sorted(h for h in coll.aggregate_array('forecast_hour').getInfo() if h <= max_hour)
    if not hours:
        return [], []
    images = [coll.filter(ee.Filter.eq('forecast_hour', h)).first().select('total_precipitation_6hr').rename(f'h{h}') for h in hours]
    return hours, images


def replay_2024():
    geometry, basin = basin_geometry()
    aoi, points = app_grid()
    steps = HOURS // 6 + 1  # 6-h steps that cover hours 0..72
    # Main issue: leads 6, 12, ... 78 h.
    hours, images = wx_issue_leads(ISSUE_2024, 6 * steps)
    stacked = ee.Image.cat(images)
    names = [f'h{h}' for h in hours]
    scale = ee.Image(images[0]).projection().nominalScale().getInfo()
    log(f'{WX_ASSET} · nominal scale {scale:.0f} m · issue 27 Nov 00Z · leads', hours)
    raw = band_series(stacked, names, geometry, WX_SCALE_M)
    log('raw total_precipitation_6hr basin means (metres per 6 h):', [round(v, 4) for v in raw])
    per_step_mm_h = [max(0.0, v) * 1000.0 / 6.0 for v in raw]  # m / 6 h -> mm/h
    log('72 h basin total mm:', round(sum(v * 6 for v in per_step_mm_h[:12]), 1))
    # Lagged ensemble: for each valid step end, the same valid hour from the four preceding issues.
    valid_ends = [ISSUE_2024 + timedelta(hours=h) for h in hours]
    lagged = [per_step_mm_h]
    used = ['27 Nov 00Z']
    for issue in LAGGED_ISSUES:
        offset = int((ISSUE_2024 - issue).total_seconds() // 3600)
        h_lag, im_lag = wx_issue_leads(issue, 6 * steps + offset)
        wanted = [h for h in h_lag if h - offset in hours]
        if len(wanted) < len(hours):
            log(f'issue {issue:%d %b %HZ} not in the archive (or short); skipped')
            continue
        used.append(f'{issue:%d %b %HZ}')
        stack = ee.Image.cat([im for h, im in zip(h_lag, im_lag) if h in wanted])
        vals = band_series(stack, [f'h{h}' for h in wanted], geometry, WX_SCALE_M)
        lagged.append([max(0.0, v) * 1000.0 / 6.0 for v in vals])
        log(f'issue {issue:%d %b %HZ} · leads {wanted[0]}..{wanted[-1]} h · total {round(sum(v * 6 for v in lagged[-1][:12]), 1)} mm')
    arr = np.array(lagged)  # issues x steps
    q = {k: np.percentile(arr, p, axis=0) for k, p in (('p10', 10), ('p50', 50), ('p90', 90))}
    grid = grid_samples(stacked, names, points, WX_SCALE_M)  # steps x cells, metres per 6 h

    def expand(step_values):
        return [round(float(step_values[min(h // 6, len(step_values) - 1)]), 3) for h in range(HOURS)]

    payload = {
        'source': f'{WX_LABEL}, issue 2024-11-27 00Z',
        'terms': 'CC BY 4.0 (historic WeatherNext data)',
        'mode': 'replay-2024',
        'issuedAt': iso(ISSUE_2024),
        'validFrom': iso(ISSUE_2024),
        'station': 'Kuala Krai, Sungai Kelantan',
        'aoi': aoi,
        'grid': {'cols': GRID_COLS, 'rows': GRID_ROWS},
        'hours': HOURS,
        'units': {'rain': 'mm/h', 'order': 'row-major, north row first'},
        'basin': {'name': basin['name'], 'areaKm2': basin['areaKm2'], 'source': 'HydroBASINS v1 level 9'},
        'catchmentMeanMmPerHour': expand(per_step_mm_h),
        'catchmentMeanQuantiles': {k: expand(v) for k, v in q.items()},
        'band': f"lagged ensemble: p10/p50/p90 across the {', '.join(used)} issues for the same valid hour",
        'spatial': '0.25 deg nearest cell, each 6 h accumulation spread evenly over its hours',
        'gauge': {
            'reading': None,
            'station': 'Kuala Krai (Sungai Kelantan), danger level 25.0 m',
            'at': iso(ISSUE_2024),
            'note': 'reading not found for 2024-11-27 00Z; Bernama reported 25.17 m at Kuala Krai on 29 Nov 2024 08:00 MYT',
        },
        'rain': [[round(max(0.0, v) * 1000.0 / 6.0, 2) for v in grid[min(h // 6, len(grid) - 1)]] for h in range(HOURS)],
    }
    write(OUT_2024, payload)


# --- Dec 2014 hindcast -------------------------------------------------------

def hindcast_2014():
    geometry, basin = basin_geometry()
    aoi, points = app_grid()
    end = START_2014 + timedelta(hours=HOURS)
    coll = ee.ImageCollection('ECMWF/ERA5_LAND/HOURLY').filterDate(iso(START_2014), iso(end)).sort('system:time_start')
    times = coll.aggregate_array('system:time_start').getInfo()
    assert len(times) == HOURS, f'expected {HOURS} hourly images, got {len(times)}'
    images = [ee.Image(coll.filter(ee.Filter.eq('system:time_start', t)).first()).select('total_precipitation_hourly').rename(f'h{i}') for i, t in enumerate(times)]
    stacked = ee.Image.cat(images)
    names = [f'h{i}' for i in range(HOURS)]
    raw = band_series(stacked, names, geometry, ERA_SCALE_M)  # metres per hour
    mm_h = [round(max(0.0, v) * 1000.0, 3) for v in raw]
    log('22 Dec 06Z .. +72 h basin total mm:', round(sum(mm_h), 1), '· max hourly', round(max(mm_h), 2))
    grid = grid_samples(stacked, names, points, ERA_SCALE_M)
    payload = {
        'source': 'ERA5-Land reanalysis (observation-based, ECMWF/C3S, hourly, ~11 km), 2014-12-22 06Z + 72 h',
        'terms': 'Copernicus C3S licence (free with attribution)',
        'mode': 'hindcast-2014',
        'issuedAt': iso(START_2014),
        'validFrom': iso(START_2014),
        'station': 'Kuala Krai, Sungai Kelantan',
        'aoi': aoi,
        'grid': {'cols': GRID_COLS, 'rows': GRID_ROWS},
        'hours': HOURS,
        'units': {'rain': 'mm/h', 'order': 'row-major, north row first'},
        'basin': {'name': basin['name'], 'areaKm2': basin['areaKm2'], 'source': 'HydroBASINS v1 level 9'},
        'catchmentMeanMmPerHour': mm_h,
        'spatial': '0.1 deg nearest cell',
        'gauge': {
            'reading': None,
            'station': 'Kuala Krai (Sungai Kelantan), danger level 25.0 m',
            'at': iso(START_2014),
            'note': 'reading not found for 2014-12-22 06Z; the gauge reached its 34.2 m record on 25 Dec 2014',
        },
        'rain': [[round(max(0.0, v) * 1000.0, 2) for v in grid[h]] for h in range(HOURS)],
    }
    write(OUT_2014, payload)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--export-basin', action='store_true')
    parser.add_argument('--replay-2024', action='store_true')
    parser.add_argument('--hindcast-2014', action='store_true')
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--asset', help='override the WeatherNext archive asset id')
    args = parser.parse_args()
    if args.asset:
        global WX_ASSET, WX_LABEL
        WX_ASSET = args.asset
        WX_LABEL = f'WeatherNext archive (Earth Engine asset {args.asset.split("/")[-1]})'
    init_ee()
    if args.export_basin or (args.all and not BASIN.exists()):
        export_basin()
    if args.replay_2024 or args.all:
        replay_2024()
    if args.hindcast_2014 or args.all:
        hindcast_2014()


if __name__ == '__main__':
    main()
