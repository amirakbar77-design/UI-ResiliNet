"""Reproducible, preliminary spatial agreement test; never a forecast accuracy claim.

Run with Python containing numpy, rasterio, pyproj and matplotlib.
Downloads are deliberately separate: see outputs/flood-validation-2014/README.md.
"""
from pathlib import Path
import json
import hashlib
import numpy as np
import rasterio
from rasterio.transform import Affine
from rasterio.windows import from_bounds, Window
from rasterio.warp import reproject, Resampling
from rasterio.features import shapes
from pyproj import Geod
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap, LightSource
from matplotlib.patches import Patch

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/flood-validation-2014'
SOURCE = OUT / 'source/DFO_4216_From_20141220_to_20150101.tif'
TERRAIN = ROOT / 'public/terrain'
OUT.mkdir(parents=True, exist_ok=True)
meta = json.loads((TERRAIN / 'terrain.json').read_text())
a = meta['aoi']; w = meta['grid']['width']; h = meta['grid']['height']
dx = (a['east'] - a['west']) / (w-1)
dy = (a['north'] - a['south']) / (h-1)
# App grid samples are at the AOI endpoints, not raster corners.
model_transform = Affine(dx, 0, a['west']-dx/2, 0, -dy, a['north']+dy/2)
hand = np.fromfile(TERRAIN/'hand.bin', dtype='u1').reshape(h,w)
elevation = np.fromfile(TERRAIN/'elevation.bin', dtype='<i2').reshape(h,w)
# Same as HINDCAST_2014 and gaugeToHandLevel (danger=25, slope=1).
GAUGE = 34.2
LEVEL = GAUGE - 25
model = ((hand != 255) & (hand.astype(float)/10 < LEVEL)).astype('uint8')

def raster(path, data, transform, descriptions):
    if data.ndim == 2: data = data[None,:,:]
    with rasterio.open(path, 'w', driver='GTiff', width=data.shape[2],
                       height=data.shape[1], count=len(data), dtype=data.dtype,
                       crs='EPSG:4326', transform=transform, compress='deflate') as dst:
        dst.write(data)
        for i, name in enumerate(descriptions, 1): dst.set_band_description(i,name)

def polygons(path, mask, transform):
    features = [{'type':'Feature', 'properties':{'class':'flood'}, 'geometry':g}
                for g,v in shapes(mask.astype('uint8'), mask=mask.astype(bool), transform=transform) if v == 1]
    path.write_text(json.dumps({'type':'FeatureCollection','features':features}))

raster(OUT/'model-native-34.2m.tif', model, model_transform, ['model_water_1_dry_0'])
polygons(OUT/'model-native-outline.geojson', model, model_transform)

with rasterio.open(SOURCE) as src:
    rawwin = from_bounds(a['west'], a['south'], a['east'], a['north'], src.transform)
    # Only complete satellite cells inside the app AOI; never extend coverage.
    left, top = int(np.ceil(rawwin.col_off)), int(np.ceil(rawwin.row_off))
    right = int(np.floor(rawwin.col_off+rawwin.width))
    bottom = int(np.floor(rawwin.row_off+rawwin.height))
    win = Window(left,top,right-left,bottom-top)
    ref = src.read(window=win)
    valid_source = np.all(src.read_masks(window=win)>0, axis=0) & np.all(np.isfinite(ref),axis=0)
    transform = src.window_transform(win)
    descriptions = list(src.descriptions)
    assert descriptions == ['flooded','duration','clear_views','clear_perc','jrc_perm_water'], descriptions
    assert src.crs.to_epsg() == 4326
    source_meta = {'crs':str(src.crs),'resolution_degrees':list(src.res), 'bands':descriptions}
raster(OUT/'satellite-2014-aoi.tif', ref, transform, descriptions)
H,W = ref.shape[1:]
fraction = np.zeros((H,W), dtype='float32')
reproject(model.astype('float32'), fraction, src_transform=model_transform,
          src_crs='EPSG:4326', dst_transform=transform, dst_crs='EPSG:4326',
          resampling=Resampling.average)
observed = ref[0] == 1
permanent = ref[4] == 1
valid = valid_source & (ref[2] >= 1) & ~permanent
predicted = fraction >= .5
raster(OUT/'model-fraction-on-satellite-grid.tif', fraction, transform, ['fraction_of_cell_modelled_water'])
geod = Geod(ellps='WGS84')
area = np.empty((H,W))
for y in range(H):
    west,north = transform*(0,y); east,south=transform*(1,y+1)
    area[y,:] = abs(geod.polygon_area_perimeter([west,east,east,west],[north,north,south,south])[0])/1e6
xs = transform.c + (np.arange(W)+.5)*transform.a
ys = transform.f + (np.arange(H)+.5)*transform.e
xx,yy = np.meshgrid(xs,ys)

def metrics(p, usable):
    tp=float(area[usable & p & observed].sum())
    fp=float(area[usable & p & ~observed].sum())
    fn=float(area[usable & ~p & observed].sum())
    tn=float(area[usable & ~p & ~observed].sum())
    div=lambda n,d: n/d if d else None
    usable_reference = tp+fn > 0
    return {'reference_suitable_for_flood_overlap':usable_reference,
            'intersection_km2':tp,'model_only_km2':fp,'satellite_only_km2':fn,
            'both_dry_km2':tn,'valid_area_km2':tp+fp+fn+tn,
            'satellite_flood_km2':tp+fn,'model_flood_km2':tp+fp,
            'iou':div(tp,tp+fp+fn) if usable_reference else None,
            'precision':div(tp,tp+fp) if usable_reference else None,
            'recall':div(tp,tp+fn) if usable_reference else None,
            'f1':div(2*tp,2*tp+fp+fn) if usable_reference else None}

primary = metrics(predicted,valid)
sensitivity = {f'model_fraction_{t:.1f}':metrics(fraction>=t,valid) for t in [.1,.5,.9]}
cloud_sensitivity = {f'min_clear_views_{n}':metrics(predicted,valid & (ref[2]>=n)) for n in [1,3,5]}
local={}
for name,lon,lat in [('Kuala Krai',102.19937,5.53116),('Dabong',102.00884,5.37848)]:
    # Fixed geographic windows, stated explicitly; not optimized for scores.
    m=(abs(xx-lon)<=.045)&(abs(yy-lat)<=.045)
    local[name]={'bounds':[lon-.045,lat-.045,lon+.045,lat+.045],**metrics(predicted,valid&m)}
reference_ok = primary['reference_suitable_for_flood_overlap']
result={'status':('preliminary satellite agreement, not validated forecast accuracy' if reference_ok else
                 'REFERENCE REJECTED: no satellite-detected flood pixels in this AOI; accuracy not estimable'),
        'event_id':4216,'observation_window':['2014-12-20','2015-01-01'],
        'model_gauge_metres':GAUGE,'model_hand_threshold_metres':LEVEL,
        'model_rule':'hand != 255 and hand/10 < (34.2-25)',
        'model_resampling':'area-average to satellite grid; wet if >= 50%',
        'reference':source_meta,'aoi':a,'evaluated_grid':[W,H],
        'total_grid_area_km2':float(area.sum()),
        'excluded_permanent_water_km2':float(area[permanent].sum()),
        'excluded_no_clear_or_nodata_km2':float(area[~permanent & ~valid].sum()),
        'clear_views_min_max':[float(np.nanmin(ref[2])),float(np.nanmax(ref[2]))],
        'clear_perc_raw_min_median_max':[float(np.nanmin(ref[3])),float(np.nanmedian(ref[3])),float(np.nanmax(ref[3]))],
        'primary':primary,'aggregation_sensitivity':sensitivity,
        'clear_view_sensitivity':cloud_sensitivity,'local_windows':local,
        'sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in [SOURCE,TERRAIN/'hand.bin',TERRAIN/'terrain.json']}}
(OUT/'metrics.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
# Class 255 is unscored, 0 both dry, 1 satellite only, 2 model only, 3 overlap.
classes=np.full((H,W),255,dtype='uint8')
classes[valid]=observed[valid].astype('uint8') + 2*predicted[valid].astype('uint8')
raster(OUT/'comparison-classes.tif',classes,transform,['0_both_dry_1_satellite_only_2_model_only_3_overlap_255_unscored'])
for name,mask in [('satellite-outline',observed&valid),('model-comparison-outline',predicted&valid),('intersection-outline',observed&predicted&valid)]:
    polygons(OUT/(name+'.geojson'),mask,transform)

plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
BLUE='#267bc2'; ORANGE='#d67621'; GREEN='#157d66'; INK='#152c3a'
extent=(transform.c,transform.c+W*transform.a,transform.f+H*transform.e,transform.f)
shade=LightSource(azdeg=315,altdeg=45).hillshade(elevation,vert_exag=1,dx=61.74,dy=61.74)

def base(ax, exclusions=True):
    ax.set_facecolor('#f4f6f5')
    ax.imshow(shade,extent=(a['west'],a['east'],a['south'],a['north']),cmap='Greys',alpha=.17,vmin=0,vmax=1)
    excluded=np.ma.masked_where(valid,np.ones_like(valid))
    if exclusions: ax.imshow(excluded,extent=extent,cmap=ListedColormap(['#cfd5d8']),alpha=.75,interpolation='nearest')
    ax.set_xlim(extent[:2]);ax.set_ylim(extent[2:]);ax.set_aspect(1/np.cos(np.deg2rad(5.43)))
    ax.set_xlabel('Longitude °E');ax.set_ylabel('Latitude °N')
    ax.tick_params(labelsize=8,color='#8899a2')
    ax.text(.97,.96,'N ↑',transform=ax.transAxes,ha='right',color=INK,fontweight='bold')
    for name,lon,lat in [('Kuala Krai',102.19937,5.53116),('Dabong',102.00884,5.37848),('Manek Urai',102.23348,5.38838)]:
        ax.plot(lon,lat,'o',color=INK,ms=3)
        ax.annotate(name,(lon,lat),xytext=(5,7),textcoords='offset points',fontsize=8,color=INK,
                    bbox={'facecolor':'white','alpha':.85,'edgecolor':'none','pad':1.5})
    # Geodesically calculated 5 km eastward scale bar.
    x0,y0=extent[0]+.018,extent[2]+.022
    x1,_,_=geod.fwd(x0,y0,90,5000)
    ax.plot([x0,x1],[y0,y0],color=INK,lw=2)
    ax.text((x0+x1)/2,y0+.005,'5 km',ha='center',fontsize=8,color=INK)

def fill(ax,mask,color):
    ax.imshow(np.ma.masked_where(~mask,np.ones(mask.shape)),extent=extent,
              cmap=ListedColormap([color]),interpolation='nearest',alpha=.85)

def outline(ax,mask,color):
    if mask.any():ax.contour(xs,ys,mask.astype(float),levels=[.5],colors=[color],linewidths=.7)

def panel(ax,mode):
    base(ax)
    if mode=='satellite':fill(ax,observed&valid,BLUE);outline(ax,observed&valid,BLUE)
    elif mode=='model':fill(ax,predicted&valid,ORANGE);outline(ax,predicted&valid,ORANGE)
    elif mode=='outlines':outline(ax,observed&valid,BLUE);outline(ax,predicted&valid,ORANGE)
    else:
        for v,c in [(1,BLUE),(2,ORANGE),(3,GREEN)]:fill(ax,classes==v,c)
    if not reference_ok:
        ax.text(.5,.02,'REFERENCE UNSUITABLE · no mapped flood pixels',transform=ax.transAxes,
                ha='center',fontsize=8,color='#973f25',bbox={'facecolor':'white','edgecolor':'none','alpha':.95})

titles={'satellite':'Satellite-detected flood','model':'ResiliNet flood model','overlay':'Where the maps agree','outlines':'Two flood outlines, one map'}
for mode in titles:
    fig,ax=plt.subplots(figsize=(9,8.7));panel(ax,mode)
    fig.suptitle(titles[mode],x=.12,y=.97,ha='left',fontsize=21,fontweight='bold',color=INK)
    fig.text(.12,.92,'Kuala Krai–Dabong · December 2014 comparison',color='#536b78',fontsize=11)
    handles=([Patch(color=BLUE,label='Satellite only'),Patch(color=ORANGE,label='Model only'),Patch(color=GREEN,label='Both maps')]
             if mode=='overlay' else [Patch(color=BLUE,label='Satellite flood'),Patch(color=ORANGE,label='Model flood')]
             if mode=='outlines' else [Patch(color=BLUE if mode=='satellite' else ORANGE,label='Flood extent')])
    handles.append(Patch(color='#cfd5d8',label='Excluded / unscored'))
    ax.legend(handles=handles,loc='upper left',fontsize=8,framealpha=.95)
    fig.text(.12,.045,'Satellite: GFD event 4216, 20 Dec 2014–1 Jan 2015 (~250 m). Model: gauge 34.2 m / HAND 9.2 m.\nPermanent water and cells without clear views excluded. Model aggregated to satellite resolution.\nPreliminary agreement, not proof of forecast accuracy. Sources: Tellman et al. (2021); ResiliNet / NASA SRTM.',fontsize=8,color='#536b78',linespacing=1.5)
    fig.subplots_adjust(left=.12,right=.96,bottom=.15,top=.87)
    fig.savefig(OUT/f'{mode}.png',dpi=220,facecolor='white');fig.savefig(OUT/f'{mode}.pdf',facecolor='white');plt.close(fig)

fig,axes=plt.subplots(1,3,figsize=(18,7.8))
for ax,mode in zip(axes,['satellite','model','overlay']):
    panel(ax,mode);ax.set_title(titles[mode],loc='left',fontweight='bold',color=INK,pad=12)
fig.suptitle('How closely does ResiliNet match the 2014 flood?',x=.055,y=.97,ha='left',fontsize=23,fontweight='bold',color=INK)
pct=lambda v:'N/A' if v is None else f'{100*v:.1f}%'
fig.text(.055,.89,(f"OVERLAP (IoU)  {pct(primary['iou'])}        SATELLITE FLOOD CAPTURED  {pct(primary['recall'])}        MODEL FLOOD CONFIRMED  {pct(primary['precision'])}" if reference_ok else
                   'ACCURACY NOT ESTIMABLE — this satellite product has no mapped flood pixels in the study area.'),fontsize=13,color=INK)
fig.legend(handles=[Patch(color=BLUE,label='Satellite only'),Patch(color=ORANGE,label='Model only'),Patch(color=GREEN,label='Both maps'),Patch(color='#cfd5d8',label='Excluded / unscored')],loc='lower center',bbox_to_anchor=(.5,.105),ncol=4,frameon=False)
fig.text(.055,.055,'Preliminary spatial agreement • GFD satellite event 4216 (20 Dec 2014–1 Jan 2015), ~250 m • Historical-peak-conditioned model (34.2 m gauge).\nClouds, coarse pixels and timing limit this comparison. Permanent water excluded. This does not measure rainfall forecast accuracy. Sources: Tellman et al. (2021); ResiliNet / NASA SRTM.',fontsize=9,color='#536b78',linespacing=1.5)
fig.subplots_adjust(left=.055,right=.985,bottom=.22,top=.80,wspace=.20)
fig.savefig(OUT/'comparison.png',dpi=220,facecolor='white');fig.savefig(OUT/'comparison.pdf',facecolor='white');plt.close(fig)

# A complete model outline, independent of the rejected reference's coverage mask.
fig,ax=plt.subplots(figsize=(10,9))
base(ax,exclusions=False)
mx=np.linspace(a['west'],a['east'],w);my=np.linspace(a['north'],a['south'],h)
ax.contourf(mx,my,model,levels=[.5,1.5],colors=[ORANGE],alpha=.25)
ax.contour(mx,my,model,levels=[.5],colors=[ORANGE],linewidths=.6)
ax.set_title('ResiliNet | modelled flood outline',loc='left',fontsize=21,fontweight='bold',color=INK,pad=24)
fig.text(.13,.045,'Kuala Krai–Dabong · Historical scenario: 34.2 m gauge → 9.2 m HAND threshold.\nExported from the real app grid (~62 m); includes channel water. Not an observed 2014 flood map.\nIllustrative gauge-to-HAND conversion; independent spatial validation remains pending.',fontsize=9,color='#536b78',linespacing=1.6)
fig.subplots_adjust(left=.13,right=.96,bottom=.17,top=.89)
fig.savefig(OUT/'model-native-outline.png',dpi=220,facecolor='white');fig.savefig(OUT/'model-native-outline.pdf',facecolor='white');plt.close(fig)
print(json.dumps(result,indent=2))
