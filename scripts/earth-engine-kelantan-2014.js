// Kuala Krai–Dabong, December 2014 flood-outline workflow for the
// Google Earth Engine Code Editor: https://code.earthengine.google.com/
//
// RUN 1 — inventory:
//   Leave RUN_ANALYSIS false. The Console lists all available Sentinel-1
//   modes, polarisations, passes and relative orbits. It also searches a wider
//   period so a zero-scene event window is clear rather than causing errors.
//
// RUN 2 — analysis, only if the inventory contains a suitable pair:
//   Set MODE, POLARISATION, ORBIT_PASS and RELATIVE_ORBIT to matching before
//   and event acquisitions, then set RUN_ANALYSIS true.

var aoi = ee.Geometry.Rectangle([101.88, 5.26, 102.28, 5.60], null, false);
Map.centerObject(aoi, 10);
Map.addLayer(aoi, {color: 'white'}, 'ResiliNet AOI', false);

var BEFORE_START = '2014-10-03';
var BEFORE_END = '2014-12-20';
var EVENT_START = '2014-12-20';
var EVENT_END = '2015-01-02'; // filterDate end is exclusive
var SEARCH_START = '2014-09-01';
var SEARCH_END = '2015-04-01';

var RUN_ANALYSIS = false;
var MODE = null;             // e.g. 'IW', 'SM' or 'EW'
var POLARISATION = null;     // e.g. 'VV' or 'HH'
var ORBIT_PASS = null;       // 'ASCENDING' or 'DESCENDING'
var RELATIVE_ORBIT = null;   // number shown in the Console

var rawS1 = ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(aoi);

function formattedDates(collection) {
  return collection.aggregate_array('system:time_start').map(function (millis) {
    return ee.Date(millis).format('YYYY-MM-dd HH:mm');
  });
}

function s1Inventory(collection, start, end, label) {
  var scenes = collection.filterDate(start, end).sort('system:time_start');
  print(label, ee.Dictionary({
    count: scenes.size(),
    dates: formattedDates(scenes),
    modes: scenes.aggregate_array('instrumentMode').distinct(),
    polarisations: scenes.aggregate_array('transmitterReceiverPolarisation').distinct(),
    passes: scenes.aggregate_array('orbitProperties_pass').distinct(),
    relative_orbits: scenes.aggregate_array('relativeOrbitNumber_start').distinct(),
    image_ids: scenes.aggregate_array('system:index')
  }));
  print(label + ' collection (expand to inspect each image)', scenes);
  return scenes;
}

s1Inventory(rawS1, BEFORE_START, BEFORE_END, 'S1 BEFORE window');
s1Inventory(rawS1, EVENT_START, EVENT_END, 'S1 EVENT window');
s1Inventory(rawS1, SEARCH_START, SEARCH_END, 'S1 WIDE search');

function configuredS1() {
  var collection = rawS1;
  if (MODE !== null) collection = collection.filter(ee.Filter.eq('instrumentMode', MODE));
  if (POLARISATION !== null) {
    collection = collection
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', POLARISATION))
      .select(POLARISATION);
  }
  if (ORBIT_PASS !== null) {
    collection = collection.filter(ee.Filter.eq('orbitProperties_pass', ORBIT_PASS));
  }
  if (RELATIVE_ORBIT !== null) {
    collection = collection.filter(ee.Filter.eq('relativeOrbitNumber_start', RELATIVE_ORBIT));
  }
  return collection;
}

function buildRadarOutline(beforeScenes, eventScenes) {
  var before = beforeScenes.median().focal_median(30, 'circle', 'meters');
  var event = eventScenes.median().focal_median(30, 'circle', 'meters');
  Map.addLayer(before.clip(aoi), {min: -25, max: 0}, 'Sentinel-1 before', false);
  Map.addLayer(event.clip(aoi), {min: -25, max: 0}, 'Sentinel-1 event', true);

  // Starting values only. Calibrate against independent known wet/dry points;
  // never tune them to maximize agreement with the ResiliNet output.
  var EVENT_WATER_DB = -16;
  var DROP_DB = -3;
  var changeDb = event.subtract(before);
  var candidate = event.lt(EVENT_WATER_DB).and(changeDb.lt(DROP_DB));
  var permanentWater = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
    .select('seasonality').gte(10);
  var elevation = ee.Image('NASA/NASADEM_HGT/001').select('elevation');
  var slope = ee.Terrain.slope(elevation);
  candidate = candidate.and(permanentWater.not()).and(slope.lt(5)).selfMask();
  candidate = candidate.updateMask(candidate.connectedPixelCount(100, true).gte(8))
    .rename('flood');

  Map.addLayer(changeDb.clip(aoi),
    {min: -8, max: 8, palette: ['00b7ff', 'ffffff', 'ff4d45']},
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
      mode: MODE,
      polarisation: POLARISATION,
      orbit_pass: ORBIT_PASS,
      relative_orbit: RELATIVE_ORBIT,
      event_water_db: EVENT_WATER_DB,
      change_db: DROP_DB,
      status: 'candidate outline requiring visual and field validation'
    });
  });

  var floodAreaKm2 = candidate.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: aoi, scale: 20, maxPixels: 1e9
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
}

if (RUN_ANALYSIS) {
  if (MODE === null || POLARISATION === null || ORBIT_PASS === null ||
      RELATIVE_ORBIT === null) {
    print('STOP: fill all four Sentinel-1 configuration values before analysis.');
  } else {
    var selected = configuredS1();
    var selectedBefore = selected.filterDate(BEFORE_START, BEFORE_END);
    var selectedEvent = selected.filterDate(EVENT_START, EVENT_END);
    selectedBefore.size().evaluate(function (beforeCount) {
      selectedEvent.size().evaluate(function (eventCount) {
        print('Selected before/event scene counts', beforeCount, eventCount);
        if (beforeCount < 1 || eventCount < 1) {
          print('STOP: no matched before/event pair. Do not calculate an outline.');
          return;
        }
        buildRadarOutline(selectedBefore, selectedEvent);
      });
    });
  }
} else {
  print('Inventory mode only. No flood outline will be calculated.');
}

// Landsat 8: exact event and wider searches. Optical data are supporting
// evidence only when the AOI is visibly cloud-free.
var rawL8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filterBounds(aoi);
var eventL8 = rawL8.filterDate(EVENT_START, EVENT_END).sort('CLOUD_COVER');
var wideL8 = rawL8.filterDate('2014-12-01', '2015-02-01').sort('CLOUD_COVER');
print('Landsat 8 EVENT inventory', ee.Dictionary({
  count: eventL8.size(),
  dates: formattedDates(eventL8),
  cloud_cover: eventL8.aggregate_array('CLOUD_COVER'),
  product_ids: eventL8.aggregate_array('LANDSAT_PRODUCT_ID')
}));
print('Landsat 8 WIDE inventory', ee.Dictionary({
  count: wideL8.size(),
  dates: formattedDates(wideL8),
  cloud_cover: wideL8.aggregate_array('CLOUD_COVER'),
  product_ids: wideL8.aggregate_array('LANDSAT_PRODUCT_ID')
}));

eventL8.size().evaluate(function (count) {
  if (count < 1) {
    print('No Landsat 8 image exists in the exact event window. No RGB layer created.');
    return;
  }
  var image = ee.Image(eventL8.first());
  var optical = image.select(['SR_B4', 'SR_B3', 'SR_B2'])
    .multiply(0.0000275).add(-0.2);
  Map.addLayer(optical.clip(aoi), {min: 0.02, max: 0.30},
    'Landsat 8 event RGB — inspect clouds', false);
});
