import {describe, expect, test} from 'bun:test';
import {exportFile, importText, parseGpx, parseKml, toGpx, toKml} from './files';
import type {LatLng} from './polyline';

const A: LatLng[] = [
  [6.2442, -75.5812],
  [6.2518, -75.5636],
  [6.26, -75.57],
];

const lines = [
  {coords: A, name: 'Ruta & “más”', color: '#db2777'},
  {coords: A, name: 'Zona', closed: true},
  {coords: [], name: 'Empty'},
];

describe('GPX', () => {
  test('tracks (one line per segment), routes, names and skipped waypoints', () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1"><wpt lat="1" lon="2"><name>Ignored</name></wpt>
  <trk><name>Morning &amp; ride</name>
    <trkseg><trkpt lat="6.2442" lon="-75.5812"><ele>1500</ele></trkpt><trkpt lon="-75.5636" lat="6.2518"/></trkseg>
    <trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg>
  </trk>
  <rte><name><![CDATA[Route <1>]]></name><rtept lat="3" lon="4"><name>pt</name></rtept><rtept lat="5" lon="6"/></rte>
</gpx>`;
    const result = parseGpx(gpx);
    expect(result.lines.map((l) => l.name)).toEqual([
      'Morning & ride (1)',
      'Morning & ride (2)',
      'Route <1>',
    ]);
    expect(result.lines[0]!.coords).toEqual([
      [6.2442, -75.5812],
      [6.2518, -75.5636],
    ]);
    expect(result.lines[2]!.coords).toEqual([
      [3, 4],
      [5, 6],
    ]);
    expect(result.notes).toEqual(['1 waypoints were skipped.']);
  });

  test('round-trips export, zones as closed tracks', () => {
    const parsed = parseGpx(toGpx(lines));
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]!.name).toBe('Ruta & “más”');
    expect(parsed.lines[0]!.coords).toEqual(A);
    expect(parsed.lines[1]!.coords).toEqual([...A, A[0]!]);
  });
});

describe('KML', () => {
  test('LineString, Polygon (outline only), MultiGeometry names', () => {
    const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>Line</name><LineString><coordinates>-75.5812,6.2442,0 -75.5636,6.2518,0</coordinates></LineString></Placemark>
  <Placemark><name>Park</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
    0,0 1,0 1,1 0,0
  </coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>0.2,0.2 0.3,0.2 0.3,0.3 0.2,0.2</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
  <Placemark><name>Multi</name><MultiGeometry><LineString><coordinates>1,1 2,2</coordinates></LineString><LineString><coordinates>3,3 4,4</coordinates></LineString></MultiGeometry></Placemark>
</Document></kml>`;
    const result = parseKml(kml);
    expect(result.lines.map((l) => [l.name, l.closed ?? false])).toEqual([
      ['Line', false],
      ['Park', true],
      ['Multi (1)', false],
      ['Multi (2)', false],
    ]);
    expect(result.lines[1]!.coords).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(result.notes[0]).toContain('holes');
  });

  test('round-trips export with colours', () => {
    const kml = toKml(lines);
    expect(kml).toContain('<color>ff7727db</color>');
    const parsed = parseKml(kml);
    expect(parsed.lines.map((l) => [l.name, l.closed ?? false])).toEqual([
      ['Ruta & “más”', false],
      ['Zona', true],
    ]);
    expect(parsed.lines[1]!.coords).toEqual(A);
  });
});

describe('importText', () => {
  test('detects GPX, KML, GeoJSON and encoded text', () => {
    const fromGpx = importText(toGpx(lines), 'track.gpx');
    expect('lines' in fromGpx && fromGpx.lines).toHaveLength(2);
    const geojson = exportFile(lines, 'geojson', 'x').content;
    const fromGeoJson = importText(geojson, 'shapes.geojson');
    expect('lines' in fromGeoJson && fromGeoJson.lines.map((l) => l.closed ?? false)).toEqual([
      false,
      true,
    ]);
    const fromText = importText('_p~iF~ps|U_ulLnnqC_mqNvxq`@\n_p~iF~ps|U', 'lines.txt');
    expect('lines' in fromText && fromText.lines).toHaveLength(2);
  });

  test('errors', () => {
    expect(importText('<gpx></gpx>', 'a.gpx')).toEqual({
      error: 'No lines or polygons found in this file.',
    });
    expect(importText('<gpx><trk><trkseg><trkpt lat="95" lon="0"/></trkseg></trk></gpx>')).toEqual({
      error: 'Line 1 has coordinates out of range.',
    });
  });

  test('file names are slugged', () => {
    expect(exportFile(lines, 'kml', 'Medellín ruta #1').fileName).toBe('medellin-ruta-1.kml');
  });
});
