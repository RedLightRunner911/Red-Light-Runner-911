"""Offline, counts-only audit of the seven 2025 traffic TXT/XLSX pairs.

Python 3.11+, standard library only. Raw inputs must remain outside the checkout.
This deliberately does not authorize any geographic join or add rows to map tiles.
Full-row fingerprints exist only in memory and are never written to disk.
"""
import argparse
import collections
import csv
import datetime as dt
import hashlib
from functools import lru_cache
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
DATE_HEADERS = {'DATESTOP', 'DateOfStop'}
TIME_HEADERS = {'TIMESTOP', 'TimeOfStop'}
SCHEMA_SHA256 = {
    'cpd': '55538b42f7c91c7eeeebb78e1a5e5046246c25054bf7353aa610eddd8faa74e9',
    'statewide': '2f164606d747be56f0a6b11a85f308ff916487c4415b26bcfa2e6ba327b2185d',
    'lake_bluff': 'fb89bdf4f168236c9bb2213d4cd93d06b15311ccfef65462c7e467ac7e0ae54b',
}

def valid_schema(headers, family):
    return fingerprint(headers).hex() == SCHEMA_SHA256[family]

@lru_cache(maxsize=2048)
def date_value(value, excel=False):
    if excel and re.fullmatch(r'\d+(?:\.\d+)?', value):
        return (dt.date(1899, 12, 30) + dt.timedelta(days=int(float(value)))).isoformat()
    value = value.split(' ')[0]
    for fmt in ('%Y-%m-%d', '%m/%d/%Y'):
        try:
            return dt.datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    return None

@lru_cache(maxsize=100000)
def time_value(value, excel=False):
    if excel and re.fullmatch(r'\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?', value) and 0 <= float(value) < 1:
        seconds = round(float(value) * 86400)
        if seconds < 86400:
            return f'{seconds // 3600:02}:{seconds // 60 % 60:02}:{seconds % 60:02}'
    for fmt in ('%I:%M:%S %p', '%I:%M %p', '%H:%M:%S', '%H:%M'):
        try:
            return dt.datetime.strptime(value, fmt).strftime('%H:%M:%S')
        except ValueError:
            pass
    return None

def canonical(row, headers, excel=False):
    out = []
    for value, header in zip(row, headers):
        value = value.strip()
        if header in DATE_HEADERS:
            value = date_value(value, excel) or 'INVALID_DATE:' + value
        elif header in TIME_HEADERS:
            value = time_value(value, excel) or 'UNKNOWN_TIME:' + value
        elif re.fullmatch(r'-?\d+\.0+', value):
            value = value.split('.')[0]
        out.append(value)
    return out

def fingerprint(row):
    return hashlib.sha256(json.dumps(row, ensure_ascii=False, separators=(',', ':')).encode()).digest()

def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def column_index(ref):
    out = 0
    for char in re.match(r'[A-Z]+', ref)[0]:
        out = out * 26 + ord(char) - 64
    return out - 1

def xlsx_rows(path):
    """Stream all sheets, resolving shared strings and sparse cells; reject formulas."""
    with zipfile.ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            with archive.open('xl/sharedStrings.xml') as stream:
                root = ET.parse(stream).getroot()
                strings = [''.join(e.itertext()) for e in root]
                del root
        sheets = sorted(n for n in archive.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n))
        for sheet in sheets:
            with archive.open(sheet) as stream:
                context = ET.iterparse(stream, events=('start', 'end'))
                _, root = next(context)
                data_root = None
                for event, elem in context:
                    if event == 'start' and elem.tag == NS + 'sheetData':
                        data_root = elem
                    if event != 'end' or elem.tag != NS + 'row':
                        continue
                    row = []
                    for cell in elem:
                        if cell.tag != NS + 'c':
                            continue
                        index = column_index(cell.attrib['r'])
                        row.extend([''] * (index + 1 - len(row)))
                        if cell.find(NS + 'f') is not None:
                            raise ValueError('Workbook formulas are not accepted')
                        value = cell.findtext(NS + 'v', '')
                        if cell.attrib.get('t') == 's':
                            value = strings[int(value)]
                        elif cell.attrib.get('t') == 'inlineStr':
                            value = ''.join(cell.find(NS + 'is').itertext())
                        row[index] = value
                    yield sheet, row
                    elem.clear()
                    if data_root is not None:
                        data_root.clear()

def audit_pair(txt, xlsx, family, global_seen, signatures, ids, aggregates):
    initial_hashes = (file_hash(txt), file_hash(xlsx))
    count = duplicate = invalid_date = invalid_time = id_repeat = id_conflict = attribute_repeat = 0
    dates = collections.Counter()
    agencies = collections.Counter()
    pair_hashes = collections.Counter()
    export_changes = collections.Counter()
    export_columns = collections.Counter()
    stream_digest = hashlib.sha256()
    with txt.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.reader(stream, strict=True)
        headers = next(reader)
        expected = 54 if family == 'statewide' else 52
        if len(headers) != expected or not valid_schema(headers, family):
            raise ValueError('Unexpected traffic schema')
        offset = 2 if family == 'statewide' else 0
        if headers[offset] not in DATE_HEADERS or headers[offset + 1] not in TIME_HEADERS:
            raise ValueError('Unexpected traffic column order')
        for raw in reader:
            if len(raw) != expected:
                raise ValueError('Malformed traffic row; values suppressed')
            row = canonical(raw, headers)
            count += 1
            key = fingerprint(row)
            pair_hashes[key] += 1
            if family == 'statewide':
                alternative = list(row)
                for index in (6, 14):
                    if '~' in alternative[index]:
                        alternative[index] = alternative[index].replace('~', "'")
                        export_columns[headers[index]] += 1
                if alternative != row:
                    export_changes[(key, fingerprint(alternative))] += 1
            stream_digest.update(key)
            duplicate += int(key in global_seen[family])
            global_seen[family].add(key)
            agency = row[1] if family == 'statewide' else family
            if family == 'statewide' and not re.fullmatch(r'\d{1,10}', agency):
                raise ValueError('Unrecognized agency code; raw values suppressed')
            agencies[agency] += 1
            date = row[offset]
            valid_date = date.startswith('2025-') and not date.startswith('INVALID_DATE:')
            invalid_date += int(not valid_date)
            invalid_time += int(row[offset + 1].startswith('UNKNOWN_TIME:'))
            month = date[:7] if valid_date else 'invalid_or_out_of_year'
            dates[month] += 1
            attributes = fingerprint(row[offset:])
            scoped = hashlib.sha256(agency.encode() + b'\0' + attributes).digest()
            attribute_repeat += int(scoped in global_seen[family + '_attributes'])
            global_seen[family + '_attributes'].add(scoped)
            if family != 'statewide' or attributes in signatures['cpd'] or attributes in signatures['lake_bluff']:
                signatures[family].setdefault(attributes, collections.Counter())[agency] += 1
            if family == 'statewide':
                identity = fingerprint(row[:2]) if row[0] and row[1] else None
                if identity is not None:
                    prior = ids.get(identity)
                    if prior is not None:
                        id_repeat += 1
                        id_conflict += int(prior != key)
                    else:
                        ids[identity] = key
            # Counts of source rows, not unique encounters; no beat-level small groups.
            aggregates[(family, agency, month)] += 1
    print(f'TXT audited: {txt.name}: {count:,} rows', flush=True)
    sheets = {}
    workbook_hashes = collections.Counter()
    workbook_digest = hashlib.sha256()
    workbook_headers = None
    active_sheet = None
    for sheet, raw in xlsx_rows(xlsx):
        if sheet != active_sheet:
            active_sheet = sheet
            sheets[sheet] = {'rows': 0, 'traffic': raw == headers}
            workbook_headers = raw if raw == headers else None
            continue
        if not any(raw):
            continue
        sheets[sheet]['rows'] += 1
        if workbook_headers is None:
            continue
        if len(raw) > expected:
            raise ValueError('Workbook column overflow')
        raw.extend([''] * (expected - len(raw)))
        key = fingerprint(canonical(raw, workbook_headers, excel=True))
        workbook_hashes[key] += 1
        workbook_digest.update(key)
    matched = sum((pair_hashes & workbook_hashes).values())
    export_equivalent = pair_hashes.copy()
    for (original, equivalent), number in export_changes.items():
        export_equivalent[original] -= number
        export_equivalent[equivalent] += number
    export_matched = sum((export_equivalent & workbook_hashes).values())
    if initial_hashes != (file_hash(txt), file_hash(xlsx)):
        raise ValueError('Input changed during audit')
    result = dict(family=family, txt=txt.name, xlsx=xlsx.name, txt_sha256=initial_hashes[0],
                  xlsx_sha256=initial_hashes[1], columns=expected, source_rows=count,
                  repeated_full_rows=duplicate, repeated_agency_ids=id_repeat,
                  candidate_repeated_attribute_rows=attribute_repeat,
                  conflicting_agency_id_rows=id_conflict, invalid_or_out_of_year_dates=invalid_date,
                  unknown_times=invalid_time, months=dict(sorted(dates.items())),
                  agency_count=len(agencies), sheets=sheets, workbook_rows=sum(workbook_hashes.values()),
                  matching_normalized_rows=matched, txt_only_rows=count-matched,
                  matching_export_equivalent_rows=export_matched,
                  export_substitution_columns=dict(export_columns),
                  export_equivalence_rule="TXT tilde versus XLSX apostrophe in vehicle make or beat; comparison only, never source identity or geography",
                  workbook_only_rows=sum(workbook_hashes.values())-matched,
                  normalized_order_equal=stream_digest.digest()==workbook_digest.digest())
    print(f'XLSX audited: {xlsx.name}: {result["workbook_rows"]:,} rows, {matched:,} matches', flush=True)
    return result

def audit(pairs):
    seen = collections.defaultdict(set)
    signatures = collections.defaultdict(dict)
    ids = {}
    aggregates = collections.Counter()
    pairs = sorted(pairs, key=lambda p: p['family'] == 'statewide')
    files = [audit_pair(Path(p['txt']), Path(p['xlsx']), p['family'], seen, signatures, ids, aggregates) for p in pairs]
    overlaps = {}
    for family in ('cpd', 'lake_bluff'):
        found = signatures[family].keys() & signatures['statewide'].keys()
        candidates = collections.Counter()
        matching_rows = collections.Counter()
        for key in found:
            for agency in signatures['statewide'][key]:
                candidates[agency] += 1
                matching_rows[agency] += signatures['statewide'][key][agency]
        overlaps[family] = dict(distinct_attribute_rows=len(signatures[family]),
                                matching_statewide_attribute_rows=len(found),
                                candidate_agency_codes=dict(sorted(candidates.items())),
                                matching_statewide_source_rows=dict(sorted(matching_rows.items())),
                                candidate_agency_total_source_rows={agency: sum(n for (group, code, month), n in aggregates.items() if group == 'statewide' and code == agency) for agency in sorted(candidates)},
                                geographic_identity_verified=False)
    return dict(schema_version=1, reporting_year=2025, files=files, overlaps=overlaps,
                mapped_records_added=0, unique_encounters_verified=False,
                note='Full-row matches are candidate repeats, not certified unique encounters. TXT/XLSX alternatives are never summed. Agency codes are not geographic mappings.'), aggregates

def cpd_beat_month(pairs):
    """Review-only coarse counts; no polygon join, coordinates, or private fields."""
    seen = set()
    counts = collections.defaultdict(lambda: [0, 0])
    for pair in sorted((p for p in pairs if p['family'] == 'cpd'), key=lambda p: Path(p['txt']).name):
        with Path(pair['txt']).open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.reader(stream, strict=True)
            headers = next(reader)
            if not valid_schema(headers, 'cpd'):
                raise ValueError('Unexpected CPD traffic schema')
            for raw in reader:
                if len(raw) != 52:
                    raise ValueError('Malformed CPD traffic row')
                row = canonical(raw, headers)
                date = date_value(raw[0])
                if date is None or not date.startswith('2025-'):
                    raise ValueError('CPD reporting year mismatch')
                beat = row[12]
                # Never export free text accidentally supplied in a location field.
                beat = str(int(beat)) if re.fullmatch(r'\d{1,4}', beat) else 'unresolved'
                key = fingerprint(row)
                bucket = counts[(beat, date[:7])]
                bucket[0] += 1
                bucket[1] += int(key in seen)
                seen.add(key)
    return counts

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    pairs = json.loads(args.manifest.read_text(encoding='utf-8'))
    repo = Path(__file__).resolve().parent.parent
    if args.out.exists() or args.out.with_name(args.out.name + '.staging').exists():
        raise ValueError('Choose a fresh output directory')
    if args.out.resolve().is_relative_to(repo / 'public'):
        raise ValueError('Review aggregates cannot be written directly into public assets')
    if len(pairs) != 7 or collections.Counter(p['family'] for p in pairs) != {'statewide': 3, 'cpd': 3, 'lake_bluff': 1}:
        raise ValueError('Require exactly seven traffic pairs')
    for pair in pairs:
        for key in ('txt', 'xlsx'):
            if Path(pair[key]).resolve().is_relative_to(repo):
                raise ValueError('Raw input must be outside checkout')
    if len({Path(p[k]).resolve() for p in pairs for k in ('txt', 'xlsx')}) != 14:
        raise ValueError('Every traffic input must be a separate file')
    if len({Path(p[k]).name for p in pairs for k in ('txt', 'xlsx')}) != 14:
        raise ValueError('Traffic receipt filenames must be unambiguous')
    report, aggregates = audit(pairs)
    cpd_counts = cpd_beat_month(pairs)
    receipts = {file['txt']: file for file in report['files']}
    for pair in pairs:
        receipt = receipts[Path(pair['txt']).name]
        if any(file_hash(Path(pair[k])) != receipt[k + '_sha256'] for k in ('txt', 'xlsx')):
            raise ValueError('Input changed before final aggregation')
    if sum(v[0] for v in cpd_counts.values()) != sum(f['source_rows'] for f in report['files'] if f['family'] == 'cpd'):
        raise ValueError('CPD aggregate reconciliation failed')
    stage = args.out.with_name(args.out.name + '.staging')
    stage.mkdir(parents=True)
    (stage / 'audit.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    with (stage / 'agency-month-source-counts.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream)
        writer.writerow(['family', 'agency_code_or_unverified_label', 'month', 'source_rows'])
        writer.writerows((*key, count) for key, count in sorted(aggregates.items()))
    with (stage / 'cpd-beat-month-review.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream)
        writer.writerow(['beat_code_unverified', 'month', 'source_rows', 'candidate_repeat_rows', 'distinct_attribute_rows'])
        writer.writerows((*key, counts[0], counts[1], counts[0] - counts[1]) for key, counts in sorted(cpd_counts.items()))
    stage.rename(args.out)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Traffic audit failed; raw values and paths suppressed') from None
