#!/usr/bin/env python
"""Read a basin window of WeatherNext 3 statistics straight from the Zarr v3
chunks on GCS (one chunk = one lead × global grid), bypassing the store
wrapper that cannot serialise gcloud credentials."""
import json, subprocess, time, numpy as np, gcsfs, zstandard
from google.oauth2.credentials import Credentials

token = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True, check=True).stdout.strip()
fs = gcsfs.GCSFileSystem(token=Credentials(token))
root = 'weathernext3_statistics_spatial/weathernext_3_0_0_statistics/zarr/2026_to_present/'
issues = sorted(p.split('/')[-1] for p in fs.ls(root) if p.endswith('_preds'))
sixhr = [i for i in issues if i[9:11] in ('00', '06', '12', '18')]
issue = sixhr[-1]
store = f'{root}{issue}/predictions.zarr/'
meta = json.loads(fs.cat(store + 'zarr.json'))['consolidated_metadata']['metadata']
print('newest issue', issues[-1], '· using 6-hourly init', issue, '· init_time attrs:', meta['init_time']['attributes'].get('units'))

def read_array(name, lead=None):
    """Decode one Zarr v3 array (bytes + zstd codecs) for a given lead chunk."""
    a = meta[name]
    dtype = {'float32': '<f4', 'int64': '<i8', 'float64': '<f8'}[a['data_type']]
    shape = a['shape']
    chunk = a['chunk_grid']['configuration']['chunk_shape']
    key = store + name + '/c/' + ('/'.join(['0'] * len(shape)) if lead is None else '/'.join([str(lead)] + ['0'] * (len(shape) - 1)))
    if len(shape) == 0:
        key = store + name + '/c'
    raw = fs.cat(key)
    if any(c['name'] == 'zstd' for c in a['codecs']):
        raw = zstandard.ZstdDecompressor().decompressobj().decompress(raw)
    arr = np.frombuffer(raw, dtype=dtype)
    return arr.reshape(chunk if lead is not None else shape) if len(shape) else arr[0]

t0 = time.time()
lat = read_array('lat_0p1'); lon = read_array('lon_0p1')
leads = read_array('lead_time')
init = np.datetime64(meta['init_time']['attributes']['units'].replace('days since ', '').replace(' ', 'T'))
valid = init + leads.astype('timedelta64[h]')
print('grid lat %.2f..%.2f (%d) lon %.2f..%.2f (%d) · leads %d · read in %.1fs' % (lat.min(), lat.max(), lat.size, lon.min(), lon.max(), lon.size, leads.size, time.time() - t0))
# Basin (HydroBASINS trace ≈ 11,500 km² inside these bounds) and the app tile.
def window(lat0, lat1, lon0, lon1):
    r = np.where((lat >= lat0) & (lat <= lat1))[0]; c = np.where((lon >= lon0) & (lon <= lon1))[0]
    return slice(r.min(), r.max() + 1), slice(c.min(), c.max() + 1)
basin = window(4.5, 5.7, 101.4, 102.5); tile = window(5.2, 5.7, 101.8, 102.35)
print('basin cells', (basin[0].stop - basin[0].start) * (basin[1].stop - basin[1].start), '· tile cells', (tile[0].stop - tile[0].start), 'x', (tile[1].stop - tile[1].start))

t0 = time.time(); rows = []
for i in range(48):
    vals = {}
    for k in ('mean', 'p10', 'p50', 'p90'):
        chunk = read_array(f'imerg_tp_1hr_{k}', lead=i)[0]  # (lat, lon) metres/h
        vals[k] = float(np.nanmean(chunk[basin]) * 1000.0)
        if k == 'mean': vals['tile'] = float(np.nanmean(chunk[tile]) * 1000.0)
    rows.append((int(leads[i]), np.datetime_as_string(valid[i], unit='m'), vals))
print('48 leads × 4 stats read in %.1fs' % (time.time() - t0))
print('lead  valid(UTC)          basin mean   p10   p50   p90 | tile mean   (mm/h)')
for lead, v, s in rows:
    print(f'{lead:4d}  {v}  {s["mean"]:10.2f} {s["p10"]:5.2f} {s["p50"]:5.2f} {s["p90"]:5.2f} | {s["tile"]:9.2f}')
print('48 h basin total mm: mean %.1f · p90 %.1f · max hourly mean %.2f' % (sum(s['mean'] for *_, s in rows), sum(s['p90'] for *_, s in rows), max(s['mean'] for *_, s in rows)))
