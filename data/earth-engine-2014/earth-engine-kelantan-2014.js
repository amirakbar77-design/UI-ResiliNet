// Kuala Krai–Dabong, December 2014 flood-outline workflow for the
// Google Earth Engine Code Editor: https://code.earthengine.google.com/
//
// 1. Run once and inspect the two acquisition tables in the Console.
// 2. Set POLARISATION, ORBIT_PASS and RELATIVE_ORBIT to a pair of before/event
//    acquisitions with the same geometry. Run again.
// 3. Inspect the radar and candidate mask. Adjust the two documented
//    thresholds only against known flooded/dry validation points.
// 4. Export the candidate outline and review/edit it before using it as truth.

var aoi = ee.Geometry.Rectangle([101.88, 5.26, 102.28, 5.60], null, false);
Map.centerObject(aoi, 10);
Map.addLayer(aoi, {color: 'white'}, 'ResiliNet AOI', false);

var BEFORE_START = '2014-10-03';
var BEFORE_END = '2014-12-20';
var EVENT_START = '2014-12-20';
var EVENT_END = '2015-01-02'; // filterDate end is exclusive

// Set these after inspecting the Console. Null means inventory mode and can
// mix viewing geometries, which is useful for discovery but not validation.
var POLARISATION = 'VV';
var ORBIT_PASS = null;       // 'ASCENDING' or 'DESCENDING'
var RELATIVE_ORBIT = null;   // number shown in the Console

var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(aoi)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', POLARISATION))
  .select(POLARISATION);

if (ORBIT_PASS !== null) {
  s1 = s1.filter(ee.Filter.eq('orbitProperties_pass', ORBIT_PASS));
}
if (RELATIVE_ORBIT !== null) {
  s1 = s1.filter(ee.Filter.eq('relativeOrbitNumber_start', RELATIVE_ORBIT));
}

function inventory(collection, start, end, label) {
  var scenes = collection.filterDate(start, end).sort('system:time_start');
  var table = ee.FeatureCollection(scenes.toList(scenes.size()).map(function (item) {
    var image = ee.Image(item);
    return ee.Feature(null, {
      date: image.date().format('YYYY-MM-dd HH:mm'),
      pass: image.get('orbitProperties_pass'),
      relativeOrbit: image.get('relativeOrbitNumber_start'),
      polarisations: image.get('transmitterReceiverPolarisation'),
      platform: image.get('platform_number'),
      id: image.id()
    });
  }));
  print(label + ' scene count', scenes.size());
  print(label + ' acquisitions', table);
  return scenes;
}

var beforeScenes = inventory(s1, BEFORE_START, BEFORE_END, 'BEFORE');
var eventScenes = inventory(s1, EVENT_START, EVENT_END, 'EVENT');

// Median reduces SAR speckle when more than one scene exists. For a formal
// dated comparison, use the closest suitable single event acquisition instead.
var before = beforeScenes.median().focal_median(30, 'circle', 'meters');
var event = eventScenes.median().focal_median(30, 'circle', 'meters');

Map.addLayer(before.clip(aoi), {min: -25, max: 0}, 'Sentinel-1 before', false);
Map.addLayer(event.clip(aoi), {min: -25, max: 0}, 'Sentinel-1 event', true);

// Candidate open-water flood mask. These are starting thresholds, not
// universal constants. Open water tends to be dark and darker than before.
var EVENT_WATER_DB = -16;
var DROP_DB = -3;
var changeDb = event.subtract(before);
var candidate = event.lt(EVENT_WATER_DB).and(changeDb.lt(DROP_DB));

// Remove long-term permanent water, steep terrain and isolated noise.
var permanentWater = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
  .select('seasonality').gte(10);
var slope = ee.Terrain.slope(ee.Image('NASA/NASADEM_HGT/001').select('elevation'));
candidate = candidate
  .and(permanentWater.not())
  .and(slope.lt(5))
  .selfMask();
var connected = candidate.connectedPixelCount(100, true);
candidate = candidate.updateMask(connected.gte(8)).rename('flood');

Map.addLayer(changeDb.clip(aoi), {min: -8, max: 8, palette: ['00b7ff', 'ffffff', 'ff4d45']},
             'Backscatter change (event minus before)', false);
Map.addLayer(candidate.clip(aoi), {palette: ['19a7ce']}, 'Candidate flood', true);

var outline = candidate.reduceToVectors({
  geometry: aoi,
  scale: 20,
  geometryType: 'polygon',
  eightConnected: true,
  labelProperty: 'class',
  reducer: ee.Reducer.countEvery(),
  maxPixels: 1e9
}).map(function (feature) {
  return feature.set({
    source: 'COPERNICUS/S1_GRD',
    before_start: BEFORE_START,
    before_end: BEFORE_END,
    event_start: EVENT_START,
    event_end: EVENT_END,
    polarisation: POLARISATION,
    orbit_pass: ORBIT_PASS,
    relative_orbit: RELATIVE_ORBIT,
    event_water_db: EVENT_WATER_DB,
    change_db: DROP_DB,
    status: 'candidate outline requiring visual and field validation'
  });
});

var floodAreaKm2 = candidate.multiply(ee.Image.pixelArea()).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: aoi,
  scale: 20,
  maxPixels: 1e9
}).getNumber('flood').divide(1e6);
print('Candidate flood area km²', floodAreaKm2);
print('Candidate polygons', outline.size());

Map.addLayer(outline.style({color: '19a7ce', fillColor: '00000000', width: 2}),
             {}, 'Candidate flood outline', true);

Export.table.toDrive({
  collection: outline,
  description: 'KualaKrai_Dabong_2014_S1_candidate_flood_outline',
  fileFormat: 'GeoJSON'
});

Export.image.toDrive({
  image: candidate.toByte(),
  description: 'KualaKrai_Dabong_2014_S1_candidate_flood_mask',
  region: aoi,
  scale: 20,
  crs: 'EPSG:4326',
  maxPixels: 1e9,
  fileFormat: 'GeoTIFF'
});

// Optional optical context. Use the Console to inspect CLOUD_COVER and the
// QA_PIXEL layer before tracing anything; monsoon clouds can hide the flood.
var landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .filterBounds(aoi)
  .filterDate(EVENT_START, EVENT_END)
  .sort('CLOUD_COVER');
print('Landsat 8 event scenes', landsat.size());
print('Landsat 8 event inventory', landsat.aggregate_array('LANDSAT_PRODUCT_ID'));
var l8 = ee.Image(landsat.first());
var optical = l8.select(['SR_B4', 'SR_B3', 'SR_B2'])
  .multiply(0.0000275).add(-0.2);
Map.addLayer(optical.clip(aoi), {min: 0.02, max: 0.30}, 'Landsat 8 event RGB', false);
