"""Build derived 2025 assets from audited traffic extracts and pinned public references.

Requires PyMuPDF for IDOT's PDF. The output contains agency totals and beat counts
by four-hour period and weekday. Keep the original records outside the repository.
"""
import argparse
from collections import Counter, defaultdict
import csv
import datetime as dt
import json
from pathlib import Path
import re
import runpy

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / 'docs/data/illinois-2025'
audit = runpy.run_path(str(ROOT / 'scripts/audit-illinois-2025.py'))
REPORT_HASH = 'a38f324db5cc6132bb8b94bb48bfd657577c9209558f54030b75deefd738be6c'
REPORT_URL = ('https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/'
              'reports/safety/traffic-stop-studies/2025-traffic-stops-part-ii.pdf')


def checked_file(path, digest):
    if audit['file_hash'](path) != digest:
        raise ValueError(f'Input checksum mismatch: {path.name}')


def agency_directory(report):
    import pymupdf
    checked_file(report, REPORT_HASH)
    families = defaultdict(Counter)
    with (REVIEW / 'agency-month-source-counts.csv').open() as stream:
        for row in csv.DictReader(stream):
            families[row['family']][row['agency_code_or_unverified_label']] += int(row['source_rows'])
    statewide = families['statewide']
    if (len(statewide), statewide['13478'], sum(statewide.values())) != (774, 1104, 1837061):
        raise ValueError('Unexpected statewide source ownership')
    if '13194' in statewide or families['cpd'] != {'cpd': 224851} or families['lake_bluff'] != {'lake_bluff': 1517}:
        raise ValueError('Unexpected Chicago or Lake Bluff totals')
    statewide['13194'] = families['cpd']['cpd']
    statewide['13478'] = families['lake_bluff']['lake_bluff']
    agencies = {}
    with pymupdf.open(report) as document:
        for page in range(1427, 1464):
            lines = [line.strip() for line in document[page - 1].get_text().splitlines()]
            for i, code in enumerate(lines):
                if code not in statewide:
                    continue
                # Names can wrap within the second column. Numeric cells start the statistics.
                name_lines = []
                for line in lines[i + 1:]:
                    if not line or not re.search(r'[A-Z]', line):
                        break
                    name_lines.append(line)
                if not name_lines or code in agencies:
                    raise ValueError(f'Ambiguous reporting agency {code}')
                agencies[code] = dict(code=code, name=' '.join(name_lines), page=page, rows=statewide[code])
        by_name = {agency['name']: agency for agency in agencies.values()}
        if len(by_name) != len(agencies):
            raise ValueError('Ambiguous agency names in the IDOT crosswalk')
        for page in range(6, 1427):
            text = document[page - 1].get_text()
            title = re.search(r'Summary of Traffic Stops for 2025\s*-\s*([^\n]+)', text)
            total = re.search(r'Total stops:\s*([\d,]+)\.', text)
            if not title or not total:
                continue
            heading = title[1].split('Population Benchmark:')[0].strip()
            name, marker, _ = heading.partition(' - INCOMPLETE STOPS DATA SUBMITTED')
            agency = by_name.get(name)
            if agency is None:
                continue  # Statewide and district-level panels also occur in the report.
            if 'summaryPage' in agency or agency['rows'] != int(total[1].replace(',', '')):
                raise ValueError(f'Ambiguous or conflicting published total for {name}')
            agency.update(summaryPage=page, incomplete=bool(marker))
        for page, code in [(6, None), (204, '13194'), (687, '13478')]:
            n = statewide[code] if code else sum(statewide.values())
            entry = document[page - 1].get_text()
            if f'Total stops: {n:,}.' not in entry or (code and agencies[code]['name'] not in entry):
                raise ValueError(f'Published agency total mismatch on PDF page {page}')
    if set(agencies) != set(statewide) or any('summaryPage' not in a for a in agencies.values()):
        raise ValueError('Unresolved reporting agency or published total')
    return dict(year=2025, rows=sum(statewide.values()), report=REPORT_URL,
                agencies=sorted(agencies.values(), key=lambda item: (item['name'], item['code'])))


def chicago_features(manifest, boundaries, source_index):
    files = json.loads((REVIEW / 'audit.json').read_text())['files']
    expected_files = Counter(x['txt_sha256'] for x in files if x['family'] == 'cpd')
    used = Counter()
    buckets = defaultdict(Counter)
    observed = Counter()
    for item in json.loads(manifest.read_text(encoding='utf-8-sig')):
        if item['family'] != 'cpd':
            continue
        path = Path(item['txt'])
        digest = audit['file_hash'](path)
        if used[digest] >= expected_files[digest]:
            raise ValueError('Duplicate or unrecognized CPD input')
        used[digest] += 1
        with path.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            for row in reader:
                beat = str(int(row['BEAT_I'].strip()))
                date = dt.date.fromisoformat(audit['date_value'](row['DATESTOP'].strip()))
                hour = int(audit['time_value'](row['TIMESTOP'].strip())[:2])
                if date.year != 2025:
                    raise ValueError('CPD date outside 2025')
                observed[beat, date.strftime('%Y-%m')] += 1
                if beat != '3100':
                    dow = (date.weekday() + 1) % 7
                    buckets[beat][(date.year - 1990) * 56 + hour // 4 * 7 + dow] += 1
        checked_file(path, digest)
    with (REVIEW / 'cpd-beat-month-review.csv').open() as stream:
        reviewed = {(r['beat_code_unverified'], r['month']): int(r['source_rows']) for r in csv.DictReader(stream)}
    outside = sum(n for (beat, month), n in observed.items() if beat == '3100')
    if used != expected_files or observed != reviewed or outside != 1884:
        raise ValueError('CPD inputs differ from the audited beat-month counts')
    checked_file(boundaries, json.loads((REVIEW / 'coverage-review.json').read_text())['current_boundary_sha256'])
    shapes = defaultdict(list)
    for feature in json.loads(boundaries.read_bytes())['features']:
        shapes[str(int(feature['properties']['beat_num']))].append(feature['geometry'])
    if set(shapes) != set(buckets) | {'3100'} or len(buckets) != 274 or len(shapes['3100']) != 3:
        raise ValueError('Unexpected coverage in the Chicago boundary snapshot')
    features = []
    for beat, counts in sorted(buckets.items(), key=lambda pair: int(pair[0])):
        if len(shapes[beat]) != 1:
            raise ValueError(f'Ambiguous geography for Chicago beat {beat}')
        geometry = shapes[beat][0]
        if geometry['type'] not in ('Polygon', 'MultiPolygon'):
            raise ValueError(f'Invalid geometry type for beat {beat}')
        polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
        points = [p for polygon in polygons for ring in polygon for p in ring]
        bbox = [min(p[0] for p in points), min(p[1] for p in points),
                max(p[0] for p in points), max(p[1] for p in points)]
        n = sum(counts.values())
        props = dict(id=f'cpd_2025:{beat}', label=f'Chicago police beat {beat}', place='Chicago',
                     n=n, src=[source_index, n], b=[v for pair in sorted(counts.items()) for v in pair], o=[], r=[])
        features.append(dict(type='Feature', bbox=bbox, geometry=geometry, properties=props))
    return dict(type='FeatureCollection', features=features)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('manifest', 'boundaries', 'report', 'out'):
        parser.add_argument('--' + key, required=True, type=Path)
    args = parser.parse_args()
    index = json.loads((ROOT / 'public/data/stop-heat/index.json').read_text(encoding='utf8'))
    ids = [source['id'] for source in index['sources']]
    beats = chicago_features(args.manifest, args.boundaries, ids.index('cpd_2025') if 'cpd_2025' in ids else len(ids))
    directory = agency_directory(args.report)
    args.out.mkdir(parents=True, exist_ok=False)
    for name, data in [('cpd_2025.json', beats), ('agencies.json', directory)]:
        (args.out / name).write_bytes(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf8'))


if __name__ == '__main__':
    main()
