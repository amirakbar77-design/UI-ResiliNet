#!/usr/bin/env python
"""
Writes public/forecast-live.json from the newest 6-hourly WeatherNext 3
statistics init: basin-mean IMERG-calibrated precipitation (ensemble mean,
p10, p50, p90) per lead in mm/h, plus the 16x14 app grid cut from the
ensemble-mean field.

    .venv-wx/bin/python scripts/fetch-weathernext.py [--init YYYYMMDD_HH] [--leads 48]
    npm run forecast:live

Source: gs://weathernext3_statistics_spatial/weathernext_3_0_0_statistics/
zarr/2026_to_present/<YYYYMMDD>_<HH>hr_01_preds/predictions.zarr (Zarr v3,
0.1 deg grid, one chunk per lead x global grid, codecs bytes + zstd). The
chunks are decoded directly through gcsfs with the gcloud user token because
zarr's store wrapper cannot serialise that credential. Each decoded window is
cached in .cache/weathernext/<init>/<var>_<lead>.npy, so re-runs are instant.

Basin: public/terrain/basin.geojson, HydroBASINS level 9 traced upstream from
the Kuala Krai gauge (exported by scripts/fetch-replay.py --export-basin).
Without the file the bbox 101.4-102.5 E, 4.5-5.7 N is used and flagged.

Terms: GDM Real-Time Weather Forecasting Experimental Data Terms (real-time);
CC BY 4.0 (historic). Requires `gcloud auth login` with an account that has
WeatherNext access. Bake-time only: the app reads the JSON offline.
"""

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import gcsfs
import numpy as np
import zstandard
from google.oauth2.credentials import Credentials
from shapely import contains_xy
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache' / 'weathernext'
OUT = ROOT / 'public' / 'forecast-live.json'
TERRAIN = ROOT / 'public' / 'terrain' / 'terrain.json'
BASIN = ROOT / 'public' / 'terrain' / 'basin.geojson'
BUCKET = 'weathernext3_statistics_spatial/weathernext_3_0_0_statistics/zarr/2026_to_present/'
VARS = ('mean', 'p10', 'p50', 'p90')
# Window of the global grid that covers the basin and the app tile.
WINDOW = {'lat': (4.3, 5.9), 'lon': (101.2, 102.7)}
BBOX_FALLBACK = {'west': 101.4, 'east': 102.5, 'south': 4.5, 'north': 5.7}
GRID_COLS, GRID_ROWS = 16, 14
READ_BATCH = 8


def log(*parts):
    print('[live]', *parts, flush=True)


def gcloud_token():
    return subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True, check=True).stdout.strip()


class Store:
    """One WeatherNext 3 statistics init on GCS."""

    def __init__(self, fs, init):
        self.fs = fs
        self.init = init
        self.path = f'{BUCKET}{init}/predictions.zarr/'
        self.meta = json.loads(fs.cat(self.path + 'zarr.json'))['consolidated_metadata']['metadata']

    def array_info(self, name):
        a = self.meta[name]
        dtype = {'float32': '<f4', 'int64': '<i8', 'float64': '<f8'}[a['data_type']]
        return a, dtype

    def decode(self, name, raw, chunk_shape=None):
        a, dtype = self.array_info(name)
        if any(c['name'] == 'zstd' for c in a['codecs']):
            raw = zstandard.ZstdDecompressor().decompressobj().decompress(raw)
        arr = np.frombuffer(raw, dtype=dtype)
        return arr.reshape(chunk_shape) if chunk_shape else (arr if len(a['shape']) else arr[0])

    def read_coord(self, name):
        a, _ = self.array_info(name)
        key = self.path + name + '/c' + ('/' + '/'.join(['0'] * len(a['shape'])) if a['shape'] else '')
        return self.decode(name, self.fs.cat(key))

    def lead_key(self, name, lead_index):
        a, _ = self.array_info(name)
        return self.path + name + '/c/' + '/'.join([str(lead_index)] + ['0'] * (len(a['shape']) - 1))

    def chunk_shape(self, name):
        return self.meta[name]['chunk_grid']['configuration']['chunk_shape']


def pick_init(fs, wanted):
    inits = sorted(p.split('/')[-1] for p in fs.ls(BUCKET) if p.endswith('_preds'))
    if wanted:
        match = [i for i in inits if i.startswith(wanted.replace('_', '_') )]
        match = [i for i in inits if i[:11] == f'{wanted[:8]}_{wanted[-2:]}']
        if not match:
            sys.exit(f'init {wanted} not found; newest is {inits[-1]}')
        return match[-1]
    six_hourly = [i for i in inits if i[9:11] in ('00', '06', '12', '18')]
    return six_hourly[-1]


def init_time(store):
    units = store.meta['init_time']['attributes'].get('units', '')
    return datetime.fromisoformat(units.replace('days since ', '').replace(' ', 'T')).replace(tzinfo=timezone.utc)


def load_basin():
    if BASIN.exists():
        geo = json.loads(BASIN.read_text())
        feature = geo['features'][0] if geo.get('type') == 'FeatureCollection' else geo
        props = feature.get('properties', {})
        return shape(feature['geometry']), {
            'name': props.get('name', 'Sungai Kelantan above Kuala Krai'),
            'areaKm2': props.get('areaKm2'),
            'source': props.get('source', 'HydroBASINS v1 level 9'),
        }, False
    b = BBOX_FALLBACK
    from shapely.geometry import box
    log('basin.geojson missing; using the bbox fallback (run scripts/fetch-replay.py --export-basin)')
    return box(b['west'], b['south'], b['east'], b['north']), {
        'name': 'bbox 101.4-102.5 E, 4.5-5.7 N (fallback)',
        'areaKm2': None,
        'source': 'bounding box; HydroBASINS polygon not exported yet',
    }, True


def basin_weights(lat, lon, polygon, sub=10):
    """Fraction of each 0.1 deg cell inside the basin polygon, times cos(lat)."""
    dlat = abs(float(lat[1] - lat[0]))
    dlon = abs(float(lon[1] - lon[0]))
    offsets = (np.arange(sub) + 0.5) / sub - 0.5
    weights = np.zeros((lat.size, lon.size))
    for i, la in enumerate(lat):
        ys = la + offsets * dlat
        for j, lo in enumerate(lon):
            xs = lo + offsets * dlon
            gx, gy = np.meshgrid(xs, ys)
            inside = contains_xy(polygon, gx.ravel(), gy.ravel())
            weights[i, j] = inside.mean() * np.cos(np.radians(la))
    return weights


def bilinear(field, lat, lon, points):
    """Bilinear interpolation of a (lat, lon) field at (lat, lon) points; axes may run either way."""
    lat_asc = lat if lat[0] < lat[-1] else lat[::-1]
    f = field if lat[0] < lat[-1] else field[::-1]
    out = []
    for pla, plo in points:
        i = np.clip(np.searchsorted(lat_asc, pla) - 1, 0, lat_asc.size - 2)
        j = np.clip(np.searchsorted(lon, plo) - 1, 0, lon.size - 2)
        ty = np.clip((pla - lat_asc[i]) / (lat_asc[i + 1] - lat_asc[i]), 0, 1)
        tx = np.clip((plo - lon[j]) / (lon[j + 1] - lon[j]), 0, 1)
        v = (f[i, j] * (1 - tx) * (1 - ty) + f[i, j + 1] * tx * (1 - ty) + f[i + 1, j] * (1 - tx) * ty + f[i + 1, j + 1] * tx * ty)
        out.append(float(v))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--init', help='YYYYMMDD_HH (default: newest 00/06/12/18Z init)')
    parser.add_argument('--leads', type=int, default=48)
    args = parser.parse_args()

    fs = gcsfs.GCSFileSystem(token=Credentials(gcloud_token()))
    init = pick_init(fs, args.init)
    store = Store(fs, init)
    issued = init_time(store)
    log('init', init, '·', issued.isoformat())

    lat_all = store.read_coord('lat_0p1')
    lon_all = store.read_coord('lon_0p1')
    lead_hours = store.read_coord('lead_time').astype(int)
    rows = np.where((lat_all >= WINDOW['lat'][0]) & (lat_all <= WINDOW['lat'][1]))[0]
    cols = np.where((lon_all >= WINDOW['lon'][0]) & (lon_all <= WINDOW['lon'][1]))[0]
    rs, cs = slice(rows.min(), rows.max() + 1), slice(cols.min(), cols.max() + 1)
    lat, lon = lat_all[rs], lon_all[cs]
    leads = list(range(min(args.leads, lead_hours.size)))
    log('window', f'{lat.min():.1f}..{lat.max():.1f} N x {lon.min():.1f}..{lon.max():.1f} E', f'({lat.size} x {lon.size} cells) · leads 1..{len(leads)}')

    # Decode (or load from cache) the window of every lead x variable.
    cache = CACHE / init
    cache.mkdir(parents=True, exist_ok=True)
    fields = {}
    missing = []
    for i in leads:
        for v in VARS:
            f = cache / f'imerg_tp_1hr_{v}_{i}.npy'
            if f.exists():
                fields[(v, i)] = np.load(f)
            else:
                missing.append((v, i))
    log(f'{len(fields)} windows cached · {len(missing)} to fetch')
    t0 = time.time()
    for start in range(0, len(missing), READ_BATCH):
        batch = missing[start:start + READ_BATCH]
        keys = [store.lead_key(f'imerg_tp_1hr_{v}', i) for v, i in batch]
        raws = fs.cat(keys)
        for (v, i), key in zip(batch, keys):
            name = f'imerg_tp_1hr_{v}'
            chunk = store.decode(name, raws[key], store.chunk_shape(name))[0]  # (lat, lon) metres per hour
            window = np.ascontiguousarray(chunk[rs, cs]).astype(np.float32)
            np.save(cache / f'{name}_{i}.npy', window)
            fields[(v, i)] = window
        done = start + len(batch)
        log(f'fetched {done}/{len(missing)} · {time.time() - t0:.0f}s')

    polygon, basin_meta, fallback = load_basin()
    weights = basin_weights(lat, lon, polygon)
    cell_km2 = (0.1 * 111.32) * (0.1 * 110.57) * np.cos(np.radians(lat))[:, None]
    if basin_meta['areaKm2'] is None:
        basin_meta['areaKm2'] = round(float((weights / np.cos(np.radians(lat))[:, None] * cell_km2).sum()))
    log('basin', basin_meta['name'], f"{basin_meta['areaKm2']} km2 ·", f'{(weights > 0).sum()} cells touched')

    def basin_mean(field):
        return float(np.nansum(field * weights) / weights.sum() * 1000.0)  # m/h -> mm/h

    series = {v: [round(basin_mean(fields[(v, i)]), 3) for i in leads] for v in VARS}

    terrain = json.loads(TERRAIN.read_text())
    aoi = terrain['aoi']
    centres = []
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            centres.append((
                aoi['north'] - (r + 0.5) * (aoi['north'] - aoi['south']) / GRID_ROWS,
                aoi['west'] + (c + 0.5) * (aoi['east'] - aoi['west']) / GRID_COLS,
            ))
    rain = [[round(max(0.0, v * 1000.0), 2) for v in bilinear(fields[('mean', i)], lat, lon, centres)] for i in leads]

    valid_from = issued + timedelta(hours=int(lead_hours[leads[0]]))
    total = sum(series['mean'])
    log(f"48 h basin total: mean {total:.1f} mm · p90 {sum(series['p90']):.1f} mm · max hourly mean {max(series['mean']):.2f} mm/h")

    out = {
        'source': f"Google DeepMind WeatherNext 3 statistics (experimental), IMERG-calibrated total precipitation, init {issued.strftime('%Y-%m-%dT%H:%M:%SZ')}",
        'terms': 'GDM Real-Time Weather Forecasting Experimental Data Terms (real-time) / CC BY 4.0 (historic)',
        'mode': 'live',
        'issuedAt': issued.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'validFrom': valid_from.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'station': 'Kuala Krai, Sungai Kelantan',
        'aoi': aoi,
        'grid': {'cols': GRID_COLS, 'rows': GRID_ROWS},
        'hours': len(leads),
        'units': {'rain': 'mm/h', 'order': 'row-major, north row first'},
        'basin': basin_meta,
        'basinFallback': fallback,
        'catchmentMeanMmPerHour': series['mean'],
        'catchmentMeanQuantiles': {'p10': series['p10'], 'p50': series['p50'], 'p90': series['p90']},
        'spatial': '0.1 deg ensemble mean interpolated to the tile (about 4 x 3 model cells across it): a real gradient, not convective detail',
        'gauge': {
            'reading': None,
            'station': 'Kuala Krai (Sungai Kelantan), danger level 25.0 m',
            'note': 'enter the current JPS InfoBanjir reading; the app keeps its default until then',
        },
        'rain': rain,
    }
    OUT.write_text(json.dumps(out, separators=(',', ':')))
    log('wrote', OUT.relative_to(ROOT), f'({OUT.stat().st_size // 1024} kB)')


if __name__ == '__main__':
    main()
