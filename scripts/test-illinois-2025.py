"""Synthetic fixtures only; never load real driver records in CI."""
import collections
import csv
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json
import xml.etree.ElementTree as ET
import zipfile

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-illinois-2025.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
cities_spec = importlib.util.spec_from_file_location('cities', Path(__file__).with_name('build-illinois-2025-cities.py'))
cities = importlib.util.module_from_spec(cities_spec)
cities_spec.loader.exec_module(cities)

class TrafficAuditTests(unittest.TestCase):
    def test_seven_pair_cli_reconciles_alternatives_and_writes_only_coarse_outputs(self):
        lake_headers = 'DateOfStop,TimeOfStop,DurationOfStop,ZIP,VehicleMake,VehicleYear,DriversYearofBirth,DriverSex,DriverRace,ReasonForStop,TypeOfMovingViolation,ResultOfStop,BeatLocationOfStop,VehicleConsentSearchRequested,VehicleConsentGiven,VehicleSearchConducted,VehicleSearchConductedBy,VehicleContrabandFound,VehicleDrugsFound,VehicleDrugParaphernaliaFound,VehicleAlcoholFound,VehicleWeaponFound,VehicleStolenPropertyFound,VehicleOtherContrabandFound,VehicleDrugAmount,DriverConsentSearchRequested,DriverConsentGiven,DriverSearchConducted,DriverSearchConductedBy,PassengerConsentSearchRequested,PassengerConsentGiven,PassengerSearchConducted,PassengerSearchConductedBy,DriverPassengerContrabandFound,DriverPassengerDrugsFound,DriverPassengerDrugParaphernaliaFound,DriverPassengerAlcoholFound,DriverPassengerWeaponFound,DriverPassengerStolenPropertyFound,DriverPassengerOtherContrabandFound,DriverPassengerDrugAmount,PoliceDogPerformSniffOfVehicle,PoliceDogAlertIfSniffed,PoliceDogVehicleSearched,PoliceDogContrabandFound,PoliceDogDrugsFound,PoliceDogDrugParaphernaliaFound,PoliceDogAlcoholFound,PoliceDogWeaponFound,PoliceDogStolenPropertyFound,PoliceDogOtherContrabandFound,PoliceDogDrugAmount'.split(',')
        cpd_headers = 'DATESTOP,TIMESTOP,DURATION,ZIPCODE,VEHMAKE,VEHYEAR,YRBIRTH,DRSEX,DRRACE,REASSTOP,TYPEMOV,RESSTOP,BEAT_I,VEHCONSREQ,VEHCONSGIV,VEHSRCHCOND,VEHSRCHCONDBY,VEHCONTRA,VEHDRUGS,VEHPARA,VEHALC,VEHWEAP,VEHSTOLPROP,VEHOTHER,VEHDRAMT,DRCONSREQ,DRCONSGIV,DRVSRCHCOND,DRVSRCHCONDBY,PASSCONSREQ,PASSCONSGIV,PASSSRCHCOND,PASSSRCHCONDBY,PASSDRVCONTRA,PASSDRVDRUGS,PASSDRVPARA,PASSDRVALC,PASSDRVWEAP,PASSDRVSTOLPROP,PASSDRVOTHER,PASSDRVDRAMT,DOGPERFSNIFF,DOGALERT,DOGALERTSRCH,DOGALERTSRCHCONTRA,DOGDRUG,DOGPARA,DOGALC,DOGWEAP,DOGSTOLPROP,DOGOTHER,DOGDRAMT'.split(',')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pairs = []
            for index, family in enumerate(['statewide'] * 3 + ['cpd'] * 3 + ['lake_bluff']):
                headers = ['ID', 'AgencyCode'] + lake_headers if family == 'statewide' else cpd_headers if family == 'cpd' else lake_headers
                row = [''] * 52
                row[:2] = ['1/1/2025', '1:35:00 AM']
                row[4] = 'PRIVATE_FIXTURE'
                row[12] = '111' if family == 'cpd' else 'X~Y'
                if family == 'statewide':
                    row = [str(index), '123'] + row
                txt, xlsx = root / f'{index}.txt', root / f'{index}.xlsx'
                with txt.open('w', newline='') as stream:
                    csv.writer(stream).writerows([headers, row])
                equivalent = list(row)
                if family == 'statewide':
                    equivalent[14] = "X'Y"
                document = ET.Element(audit.NS + 'worksheet')
                data = ET.SubElement(document, audit.NS + 'sheetData')
                for number, values in enumerate([headers, equivalent], 1):
                    element = ET.SubElement(data, audit.NS + 'row')
                    for column, value in enumerate(values, 1):
                        letters, pos = '', column
                        while pos:
                            pos, digit = divmod(pos - 1, 26)
                            letters = chr(65 + digit) + letters
                        cell = ET.SubElement(element, audit.NS + 'c', r=f'{letters}{number}', t='inlineStr')
                        ET.SubElement(ET.SubElement(cell, audit.NS + 'is'), audit.NS + 't').text = value
                with zipfile.ZipFile(xlsx, 'w') as archive:
                    archive.writestr('xl/worksheets/sheet1.xml', ET.tostring(document))
                pairs.append(dict(family=family, txt=str(txt), xlsx=str(xlsx)))
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps(pairs))
            output = root / 'review'
            with patch('sys.argv', ['audit', '--manifest', str(manifest), '--out', str(output)]):
                audit.main()
            report = json.loads((output / 'audit.json').read_text())
            self.assertEqual(sum(f['source_rows'] for f in report['files']), 7)
            self.assertTrue(all(f['matching_export_equivalent_rows'] == 1 for f in report['files']))
            self.assertEqual(report['overlaps']['lake_bluff']['matching_statewide_source_rows'], {'123': 3})
            self.assertEqual(report['mapped_records_added'], 0)
            self.assertEqual(len(list(output.iterdir())), 3)
            self.assertFalse(output.with_name('review.staging').exists())
            self.assertNotIn('PRIVATE_FIXTURE', ''.join(p.read_text() for p in output.iterdir()))

    def test_cpd_month_counts_do_not_export_private_columns_or_invent_points(self):
        headers = 'DATESTOP,TIMESTOP,DURATION,ZIPCODE,VEHMAKE,VEHYEAR,YRBIRTH,DRSEX,DRRACE,REASSTOP,TYPEMOV,RESSTOP,BEAT_I,VEHCONSREQ,VEHCONSGIV,VEHSRCHCOND,VEHSRCHCONDBY,VEHCONTRA,VEHDRUGS,VEHPARA,VEHALC,VEHWEAP,VEHSTOLPROP,VEHOTHER,VEHDRAMT,DRCONSREQ,DRCONSGIV,DRVSRCHCOND,DRVSRCHCONDBY,PASSCONSREQ,PASSCONSGIV,PASSSRCHCOND,PASSSRCHCONDBY,PASSDRVCONTRA,PASSDRVDRUGS,PASSDRVPARA,PASSDRVALC,PASSDRVWEAP,PASSDRVSTOLPROP,PASSDRVOTHER,PASSDRVDRAMT,DOGPERFSNIFF,DOGALERT,DOGALERTSRCH,DOGALERTSRCHCONTRA,DOGDRUG,DOGPARA,DOGALC,DOGWEAP,DOGSTOLPROP,DOGOTHER,DOGDRAMT'.split(',')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'traffic.txt'
            row = [''] * 52
            row[0:2] = ['1/1/2025', '1:35:00 AM']
            row[4] = 'PRIVATE'
            row[12] = '0111'
            other = list(row)
            other[1] = '1:36:00 AM'
            with path.open('w', newline='') as stream:
                writer = csv.writer(stream)
                writer.writerows([headers, row, row, other])
            result = audit.cpd_beat_month([dict(family='cpd', txt=str(path))])
            self.assertEqual(dict(result), {('111', '2025-01'): [3, 1]})
            self.assertNotIn('PRIVATE', repr(result))
            other[0] = '1/1/2024'
            with path.open('a', newline='') as stream:
                csv.writer(stream).writerow(other)
            with self.assertRaisesRegex(ValueError, 'year mismatch'):
                audit.cpd_beat_month([dict(family='cpd', txt=str(path))])

    def test_calendar_and_scientific_excel_time(self):
        self.assertEqual(audit.date_value('8/19/2025 0:00'), '2025-08-19')
        self.assertEqual(audit.date_value('45658', True), '2025-01-01')
        self.assertIsNone(audit.date_value('2/29/2025'))
        self.assertEqual(audit.time_value('6.597222222222222E-2', True), '01:35:00')
        self.assertEqual(audit.time_value('12:00:00 AM'), '00:00:00')
        self.assertIsNone(audit.time_value('25:00'))
        self.assertIsNone(audit.time_value('1', True))

    def test_invalid_values_are_not_collapsed_or_written_as_dates(self):
        self.assertNotEqual(audit.canonical(['bad'], ['DATESTOP']), audit.canonical(['other'], ['DATESTOP']))
        self.assertNotEqual(audit.canonical(['bad'], ['TIMESTOP']), audit.canonical(['other'], ['TIMESTOP']))

    def test_sparse_workbook_shared_inline_and_extra_sheets(self):
        ns = audit.NS[1:-1]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test.xlsx'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('xl/sharedStrings.xml', f'<sst xmlns="{ns}"><si><t>DATESTOP</t></si></sst>')
                archive.writestr('xl/worksheets/sheet1.xml', f'<worksheet xmlns="{ns}"><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>SAFE</t></is></c></row></sheetData></worksheet>')
                archive.writestr('xl/worksheets/sheet2.xml', f'<worksheet xmlns="{ns}"><sheetData><row><c r="A1"><v>1</v></c></row></sheetData></worksheet>')
            rows = list(audit.xlsx_rows(path))
            self.assertEqual(rows[0][1], ['DATESTOP', '', 'SAFE'])
            self.assertEqual(len(rows), 2)

    def test_formula_rejected_without_evaluating_cached_value(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test.xlsx'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('xl/worksheets/sheet1.xml', f'<worksheet xmlns="{audit.NS[1:-1]}"><sheetData><row><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>')
            with self.assertRaisesRegex(ValueError, 'formulas'):
                list(audit.xlsx_rows(path))

    def test_full_row_signature_preserves_distinct_stops(self):
        first = ['2025-01-01', '01:35:00', '111', '1']
        self.assertNotEqual(audit.fingerprint(first), audit.fingerprint(first[:-1] + ['2']))
        self.assertEqual(audit.fingerprint(first), audit.fingerprint(list(first)))

    def test_champaign_district_mapping_is_case_insensitive_and_exact(self):
        self.assertEqual(cities.champaign_district('CHN'), 'North')
        self.assertEqual(cities.champaign_district('chs'), 'South')
        self.assertEqual(cities.champaign_district(' CHs '), 'South')
        self.assertEqual(cities.champaign_district('cHN'), 'North')
        self.assertEqual(cities.champaign_district('chnw'), 'Northwest')
        self.assertEqual(cities.champaign_district('CHSW'), 'Southwest')
        for code in ('CHW', 'CHNNW', 'CNW', 'S', 'SHW', 'Urb', 'URBANA', '740', '796', ''):
            self.assertIsNone(cities.champaign_district(code))
        self.assertEqual(set(cities.CHAMPAIGN_DISTRICT_BY_CODE.values()), cities.CHAMPAIGN_DISTRICTS)

if __name__ == '__main__':
    unittest.main()
