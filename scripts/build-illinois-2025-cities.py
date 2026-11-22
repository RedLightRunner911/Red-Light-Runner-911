"""Build Springfield beat and Champaign district aggregates from statewide extracts.

Keep the original records outside the repository. File 1 may be a four-city
filtered slice; its SHA-256 will not match the full-file audit receipt. Agency
totals are checked against public/data/illinois-2025/agencies.json instead.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import datetime as dt
import hashlib
import json
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / 'docs/data/illinois-2025'
audit = runpy.run_path(str(ROOT / 'scripts/audit-illinois-2025.py'))

SPRINGFIELD = '13805'
CHAMPAIGN = '13111'
URBANA = '13100'
DECATUR = '13588'
DIRECTORY_TOTALS = {SPRINGFIELD: 9934, CHAMPAIGN: 4701, URBANA: 1775, DECATUR: 5245}
SPRINGFIELD_BEATS = {str(n) for n in range(100, 900, 100)}
# Case-insensitive exact tokens only. CHNNW, CNW, CHW and similar are not matches.
CHAMPAIGN_DISTRICT_BY_CODE = {
    'CHN': 'North',
    'CHS': 'South',
    'CHNW': 'Northwest',
    'CHSW': 'Southwest',
}
CHAMPAIGN_DISTRICTS = {'North', 'Northwest', 'South', 'Southwest'}
SPRINGFIELD_BOUNDARY_URL = (
    'https://maps.springfield.il.us/server/rest/services/SPD/Beat/FeatureServer/0/'
    'query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson'
)
CHAMPAIGN_BOUNDARY_URL = (
    'https://gisportal.champaignil.gov/ms/rest/services/Open_Data/Open_Data/MapServer/26/'
    'query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson'
)
STATEWIDE_TXT_SHA256 = {
    '2025 Traffic Data 2A Redacted .txt': '429c47091f4d75ea4eef1d5864e06104d6f3cb311e1116d487eb12d35afe3921',
    '2025 Traffic Data 2B Redacted.txt': '7ed6a8ee52b8f0c7de975c5a5b2be26dd0346f222a4d8b58775c0d08cd9c3abf',
}


def champaign_district(code: str):
    return CHAMPAIGN_DISTRICT_BY_CODE.get(code.strip().upper())


def pack_feature(source_id, area_id, label, place, counts, geometry, source_index):
    if geometry['type'] not in ('Polygon', 'MultiPolygon'):
        raise ValueError(f'Invalid geometry type for {area_id}')
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    points = [p for polygon in polygons for ring in polygon for p in ring]
    bbox = [min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points)]
    n = sum(counts.values())
    props = dict(id=f'{source_id}:{area_id}', label=label, place=place,
                 n=n, src=[source_index, n], b=[v for pair in sorted(counts.items()) for v in pair], o=[], r=[])
    return dict(type='Feature', bbox=bbox, geometry=geometry, properties=props)


def collection(features):
    return dict(type='FeatureCollection', features=features)


def read_statewide_rows(paths):
    headers = None
    for path in paths:
        if path.name in STATEWIDE_TXT_SHA256:
            if audit['file_hash'](path) != STATEWIDE_TXT_SHA256[path.name]:
                raise ValueError(f'Input checksum mismatch: {path.name}')
        with path.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.reader(stream, strict=True)
            file_headers = next(reader)
            if not audit['valid_schema'](file_headers, 'statewide'):
                raise ValueError('Unexpected traffic schema')
            if headers is None:
                headers = file_headers
            elif file_headers != headers:
                raise ValueError('Statewide headers differ across input files')
            for raw in reader:
                if len(raw) != 54:
                    raise ValueError('Malformed traffic row; values suppressed')
                agency = raw[1].strip()
                if agency not in DIRECTORY_TOTALS:
                    continue
                date = audit['date_value'](raw[2].strip())
                time = audit['time_value'](raw[3].strip())
                if not date or not date.startswith('2025-') or not time:
                    raise ValueError('Invalid stop date or time')
                yield agency, raw[14].strip(), dt.date.fromisoformat(date), int(time[:2])


def add_bucket(buckets, area, date, hour):
    dow = (date.weekday() + 1) % 7
    buckets[area][(date.year - 1990) * 56 + hour // 4 * 7 + dow] += 1


def springfield_features(paths, boundaries, source_index):
    buckets, observed, months = defaultdict(Counter), Counter(), Counter()
    for agency, beat, date, hour in read_statewide_rows(paths):
        if agency != SPRINGFIELD:
            continue
        if beat not in SPRINGFIELD_BEATS:
            raise ValueError('Unexpected Springfield location code')
        observed[beat] += 1
        months[beat, date.strftime('%Y-%m')] += 1
        add_bucket(buckets, beat, date, hour)
    if observed.total() != DIRECTORY_TOTALS[SPRINGFIELD] or set(observed) != SPRINGFIELD_BEATS:
        raise ValueError('Springfield totals differ from the agency directory')
    shapes = {}
    for feature in json.loads(boundaries.read_bytes())['features']:
        beat = str(int(feature['properties']['BEAT']))
        if beat in shapes:
            raise ValueError(f'Ambiguous geography for Springfield beat {beat}')
        shapes[beat] = feature['geometry']
    if set(shapes) != SPRINGFIELD_BEATS:
        raise ValueError('Springfield boundary IDs do not match 100-800')
    features = []
    for beat, counts in sorted(buckets.items(), key=lambda pair: int(pair[0])):
        features.append(pack_feature(
            'spd_2025', beat, f'Springfield police beat {beat}', 'Springfield',
            counts, shapes[beat], source_index))
    return collection(features), months, observed


def champaign_features(paths, boundaries, source_index):
    buckets, mapped, unmatched, months, raw_codes = (
        defaultdict(Counter), Counter(), Counter(), Counter(), Counter())
    for agency, code, date, hour in read_statewide_rows(paths):
        if agency != CHAMPAIGN:
            continue
        raw_codes[code] += 1
        district = champaign_district(code)
        if district is None:
            unmatched[code] += 1
            continue
        mapped[district] += 1
        months[district, date.strftime('%Y-%m')] += 1
        add_bucket(buckets, district, date, hour)
    if mapped.total() + unmatched.total() != DIRECTORY_TOTALS[CHAMPAIGN]:
        raise ValueError('Champaign totals differ from the agency directory')
    if set(mapped) != CHAMPAIGN_DISTRICTS or mapped.total() != 4691 or unmatched.total() != 10:
        raise ValueError('Champaign district mapping did not match the reviewed counts')
    shapes = {}
    for feature in json.loads(boundaries.read_bytes())['features']:
        name = feature['properties']['District']
        if name not in CHAMPAIGN_DISTRICTS or name in shapes:
            raise ValueError('Champaign police district names are not the four expected districts')
        shapes[name] = feature['geometry']
    if set(shapes) != CHAMPAIGN_DISTRICTS:
        raise ValueError('Champaign boundary districts do not line up 1:1 with CHN/CHS/CHNW/CHSW')
    features = []
    for name in ('North', 'Northwest', 'South', 'Southwest'):
        features.append(pack_feature(
            'champaign_2025', name, f'Champaign police district {name}', 'Champaign',
            buckets[name], shapes[name], source_index))
    return collection(features), months, mapped, unmatched, raw_codes


def redact_champaign(raw: dict):
    keep = {'District', 'Area_Description'}
    features = []
    for feature in raw['features']:
        props = {k: v for k, v in feature['properties'].items() if k in keep}
        if props.get('District') not in CHAMPAIGN_DISTRICTS:
            raise ValueError('Refusing to pin an unexpected Champaign district name')
        features.append(dict(type='Feature', geometry=feature['geometry'], properties=props))
    return dict(type='FeatureCollection', features=features)


def redact_springfield(raw: dict):
    features = []
    for feature in raw['features']:
        props = {k: feature['properties'][k] for k in ('BEAT', 'BEAT_TEXT') if k in feature['properties']}
        features.append(dict(type='Feature', geometry=feature['geometry'], properties=props))
    return dict(type='FeatureCollection', features=features)


def write_json(path: Path, data):
    path.write_bytes(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode())


def write_csv(path: Path, header, rows):
    with path.open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream)
        writer.writerow(header)
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file1-slice', required=True, type=Path)
    parser.add_argument('--file2a', required=True, type=Path)
    parser.add_argument('--file2b', required=True, type=Path)
    parser.add_argument('--springfield-boundaries', required=True, type=Path)
    parser.add_argument('--champaign-boundaries', required=True, type=Path)
    parser.add_argument('--retrieved', default='2026-11-16')
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    paths = [args.file1_slice, args.file2a, args.file2b]
    if len({p.resolve() for p in paths}) != 3:
        raise ValueError('Each statewide input must be a separate file')
    directory = json.loads((ROOT / 'public/data/illinois-2025/agencies.json').read_text())
    by_code = {a['code']: a['rows'] for a in directory['agencies']}
    if any(by_code[code] != n for code, n in DIRECTORY_TOTALS.items()):
        raise ValueError('agencies.json totals do not match the expected four-city counts')

    spd_raw = json.loads(args.springfield_boundaries.read_bytes())
    ch_raw = json.loads(args.champaign_boundaries.read_bytes())
    if {f['properties']['District'] for f in ch_raw['features']} != CHAMPAIGN_DISTRICTS:
        raise ValueError('Champaign layer 26 district names do not line up 1:1 with CHN/CHS/CHNW/CHSW')
    spd_pin = redact_springfield(spd_raw)
    ch_pin = redact_champaign(ch_raw)
    spd_beats, spd_months, spd_observed = springfield_features(
        paths, args.springfield_boundaries, 0)
    ch_beats, ch_months, ch_mapped, ch_unmatched, ch_raw_codes = champaign_features(
        paths, args.champaign_boundaries, 0)

    args.out.mkdir(parents=True, exist_ok=False)
    write_json(args.out / 'spd_2025.json', spd_beats)
    write_json(args.out / 'champaign_2025.json', ch_beats)
    write_json(args.out / 'springfield-police-beats.geojson', spd_pin)
    write_json(args.out / 'champaign-police-districts.geojson', ch_pin)
    write_csv(args.out / 'spd-beat-month-review.csv',
              ['beat_code', 'month', 'source_rows'],
              sorted((beat, month, n) for (beat, month), n in spd_months.items()))
    write_csv(args.out / 'champaign-district-month-review.csv',
              ['district', 'month', 'source_rows'],
              sorted((district, month, n) for (district, month), n in ch_months.items()))
    write_csv(args.out / 'champaign-unmatched-location-codes.csv',
              ['location_code', 'source_rows'],
              sorted(ch_unmatched.items(), key=lambda item: (-item[1], item[0])))

    other = Counter()
    months = defaultdict(Counter)
    for agency, code, date, hour in read_statewide_rows(paths):
        if agency in (URBANA, DECATUR):
            other[agency] += 1
            months[agency][code] += 1
    if other[URBANA] != DIRECTORY_TOTALS[URBANA] or other[DECATUR] != DIRECTORY_TOTALS[DECATUR]:
        raise ValueError('Urbana or Decatur totals differ from the agency directory')

    meta = dict(
        review_date=args.retrieved,
        file1=dict(
            used=args.file1_slice.name,
            sha256=audit['file_hash'](args.file1_slice),
            note=('Filtered slice of 2025 Traffic Data 1 Redacted .txt containing only agency '
                  'codes 13805, 13111, 13100 and 13588. SHA-256 does not match the full-file '
                  'audit receipt 356454bf0dd633e3133471ab114c8705c96f9c98f4ea42812dd40a69dda3e862. '
                  'Four-city totals were verified against agencies.json instead.'),
        ),
        file2a=dict(name=args.file2a.name, sha256=STATEWIDE_TXT_SHA256[args.file2a.name], matches_audit=True),
        file2b=dict(name=args.file2b.name, sha256=STATEWIDE_TXT_SHA256[args.file2b.name], matches_audit=True),
        agency_totals_verified=DIRECTORY_TOTALS,
        springfield=dict(
            mapped=9934, unmapped=0, beats=8,
            beat_counts=dict(sorted((k, int(v)) for k, v in spd_observed.items())),
            boundary_url=SPRINGFIELD_BOUNDARY_URL,
            boundary_download_sha256=audit['file_hash'](args.springfield_boundaries),
            boundary_committed_sha256=hashlib.sha256(
                json.dumps(spd_pin, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest(),
            retrieved=args.retrieved,
        ),
        champaign=dict(
            mapped=4691, unmapped=10, districts=4,
            mapping=CHAMPAIGN_DISTRICT_BY_CODE,
            mapping_rule='case-insensitive exact match of the stripped location code',
            mapped_code_counts={code: int(n) for code, n in sorted(
                ch_raw_codes.items(), key=lambda item: (-item[1], item[0])) if champaign_district(code)},
            district_counts=dict(sorted(ch_mapped.items())),
            unmatched={code: int(n) for code, n in sorted(
                ch_unmatched.items(), key=lambda item: (-item[1], item[0]))},
            boundary_url=CHAMPAIGN_BOUNDARY_URL,
            boundary_download_sha256=audit['file_hash'](args.champaign_boundaries),
            boundary_committed_sha256=hashlib.sha256(
                json.dumps(ch_pin, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest(),
            retrieved=args.retrieved,
            note='Officer name, email and phone were stripped from the committed district snapshot.',
        ),
        urbana=dict(
            rows=1775,
            codes={code: int(n) for code, n in sorted(months[URBANA].items(), key=lambda item: (-item[1], item[0]))},
            note=('Most rows use beats 61-65 (1,769). Six other location codes appear on 6 rows. '
                  'No free public boundary file is available, so nothing is shaded.'),
        ),
        decatur=dict(
            rows=5245,
            codes={code: int(n) for code, n in sorted(months[DECATUR].items(), key=lambda item: (-item[1], item[0]))},
            note='Codes 801-810 appear on every row. No free public boundary file is available, so nothing is shaded.',
        ),
    )
    (args.out / 'municipal-coverage-review.json').write_text(
        json.dumps(meta, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('wrote', args.out)


if __name__ == '__main__':
    main()
