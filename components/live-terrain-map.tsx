'use client';

import type { Map as MapboxMap } from 'mapbox-gl';
import Map from 'react-map-gl/mapbox';

export function LiveTerrainMap({ token }: { token: string }) {
  const addTerrain = ({ target: map }: { target: MapboxMap }) => {
    if (!map.getSource('resilinet-dem')) {
      map.addSource('resilinet-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }
    map.setTerrain({ source: 'resilinet-dem', exaggeration: 1.45 });
  };

  return (
    <Map
      mapboxAccessToken={token}
      initialViewState={{
        longitude: 100.402,
        latitude: 5.792,
        zoom: 12,
        pitch: 60,
        bearing: -20,
      }}
      mapStyle="mapbox://styles/mapbox/outdoors-v12"
      attributionControl={false}
      onLoad={addTerrain}
      dragRotate
      touchPitch
      reuseMaps
      style={{ position: 'absolute', inset: 0 }}
    />
  );
}
