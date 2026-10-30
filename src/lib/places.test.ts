import {expect, test} from 'bun:test';
import {toPlace} from './places';

test('maps a Photon feature with an extent', () => {
  const place = toPlace({
    geometry: {coordinates: [-75.568136, 6.2500151]},
    properties: {
      osm_type: 'W',
      osm_id: 31965663,
      osm_value: 'square',
      type: 'locality',
      name: 'Parque Berrío',
      district: 'La Candelaria',
      city: 'Medellín',
      state: 'Antioquia',
      country: 'Colombia',
      extent: [-75.5685421, 6.2504663, -75.5676884, 6.2495548],
    },
  });
  expect(place).toEqual({
    id: 'W31965663',
    name: 'Parque Berrío',
    detail: 'La Candelaria, Medellín, Antioquia, Colombia',
    kind: 'square',
    lngLat: [-75.568136, 6.2500151],
    bbox: [
      [-75.5685421, 6.2495548],
      [-75.5676884, 6.2504663],
    ],
    zoom: 12,
    osm: {type: 'W', id: 31965663},
    span: Math.hypot(-75.5676884 - -75.5685421, 6.2504663 - 6.2495548),
  });
});

test('addresses without a name use street and number; no duplicate parts', () => {
  const place = toPlace({
    geometry: {coordinates: [2.35, 48.85]},
    properties: {
      osm_type: 'N',
      osm_id: 1,
      type: 'house',
      street: 'Rue de Rivoli',
      housenumber: '10',
      city: 'Paris',
      state: 'Paris',
      country: 'France',
    },
  });
  expect(place.name).toBe('Rue de Rivoli 10');
  expect(place.detail).toBe('Paris, France');
  expect(place.bbox).toBeUndefined();
  expect(place.zoom).toBe(17);
});
