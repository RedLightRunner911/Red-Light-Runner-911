# Illinois, Lake Bluff and CPD 2025 traffic upload audit

All fourteen uploaded traffic files were inspected on 2026-11-16. Eight are statewide or Lake Bluff files and six are CPD files. The separate pedestrian collection is excluded. See the [counts-only audit receipts](data/illinois-2025/).

## Exact counts and alternatives

- Statewide part 1: **999,999** TXT rows and the same XLSX row count; 54 columns.
- Statewide part 2A: **419,998** TXT rows and the same XLSX row count; 54 columns.
- Statewide part 2B: **417,064** TXT rows and the same XLSX row count; 54 columns.
- Statewide total: **1,837,061** rows, **774** distinct reporting-agency codes. There are no repeated full rows including ID, repeated agency/ID pairs, or conflicting copies of an agency/ID. Excluding IDs, **247** additional rows repeat all other normalized attributes within the same agency. These are candidate repeats, not proof of duplicate encounters; different source IDs must not be silently collapsed.
- CPD January–June: **134,090** rows; July–December: **88,011**; supplementary January–June: **2,750**. Each has 52 columns. Combined: **224,851** source rows, **183** candidate repeated normalized full rows, **224,668** distinct attribute rows. No unique stop IDs are supplied. The compact review CSV contains **3,278** beat-month groups across **275** beat codes.
- Revised Lake Bluff: **1,517** rows, 52 columns, no repeated normalized full rows. Its TXT/XLSX pair matches exactly after date/time normalization. It has no agency-code or stop-ID column.

These seven extracts contain **2,063,429 source rows before cross-family overlap decisions**. This is not an accepted-stop total. Never sum the fourteen files: XLSX and TXT are alternate representations. All TXT dates parse as valid 2025 calendar dates and all times parse; no dates or times were rejected in this audit.

The files named `.txt` are comma-delimited CSV, not the tilde-delimited submission format in the [IDOT 2024 specification](https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/pamphlets---brochures/safety/trafficstopdbfileformat.pdf). Date representations include ISO date-times, US dates with a midnight suffix, Excel serial dates, 24-hour clocks, AM/PM clocks and Excel fractional-day times, including scientific notation. Workbook parsing resolves shared strings, sparse cells and all worksheets; formulas are rejected.

The CPD and Lake Bluff pairs match completely after ordinary normalization. The statewide pairs have **13 / 12 / 5** strict normalized row differences. The differences are tilde versus apostrophe spellings in vehicle-make or beat text: part 1 has 7 vehicle-make and 6 beat differences; part 2A has 12 beat differences; part 2B has 4 vehicle-make and 1 beat difference. A separate comparison-only export-equivalence rule is recorded in `audit.json`. It does not rewrite source identities, beats or the cross-family overlap comparison. These alternatives are never treated as extra stops.

## Agency ownership and mapped coverage

The searchable directory contains **2,062,325 reported rows across 775 agencies**. The 2025 IDOT report supplies the code-to-name crosswalk for all 774 statewide codes and the additional Chicago code. The report also gives totals of 224,851 for Chicago (code 13194) and 1,517 for Lake Bluff (code 13478). All 775 totals also match the individual agency summaries. Each directory result links the agency name to its summary and the agency code to its crosswalk page. IDOT identifies 23 reporting agencies with incomplete submissions. Their entries carry that qualification. [Statewide summary](https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/reports/safety/traffic-stop-studies/2025-traffic-stops-part-ii.pdf#page=6) · [Chicago summary](https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/reports/safety/traffic-stop-studies/2025-traffic-stops-part-ii.pdf#page=204) · [Lake Bluff summary](https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/reports/safety/traffic-stop-studies/2025-traffic-stops-part-ii.pdf#page=687)

The statewide extract has 1,104 Lake Bluff rows. Of those, 1,100 also occur in the revised local data, four occur only in the statewide extract, and 417 occur only in the revision. The directory replaces all 1,104 with the 1,517 from the revised extract. Chicago supplies the other 224,851. The calculation is **1,837,061 − 1,104 + 1,517 + 224,851 = 2,062,325**. No CPD 52-attribute row exactly matches the statewide records after removing statewide identifiers. The Chicago and Lake Bluff published totals independently support this allocation. The directory measures agency reporting. The eight Lake Bluff local area codes and the statewide local beat or text fields have no verified subarea mapping.

The form used in 2025 identifies the field following the result of the stop as its location beat. The redacted CPD header in this position is `BEAT_I`. All 274 ordinary beat codes occur once each in the city's current boundary snapshot. Its publisher table is `PoliceBeatDec2012` with a geometry update in February 2013. We use those published polygons for 2025 beat-level shading. This identifies a reporting area and supplies no street coordinates or dated stop positions. The city publishes the layer as current and supplies no separate 2025-certified boundary edition here. [IDOT form, Appendix A](https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/reports/safety/traffic-stop-studies/2025-traffic-stops-part-i.pdf) · [Chicago boundaries](https://data.cityofchicago.org/d/aerh-rz74)

CPD defines code **3100** as outside Chicago within Illinois. It occurs on three boundary features and 1,884 uploaded rows. We omit all of them from shading. The remaining **222,967** source rows include 183 possible repeats and **222,784** distinct attribute rows. The map counts reported rows to match the study's counting basis. [CPD reporting instructions](https://directives.chicagopolice.org/forms/CPD-63.450.pdf)

The earlier Chicago source ends on 2020-05-16 and Urbana ends on 2023-02-14. The updated map contains **7,989,081** records, **275** shaded areas (274 Chicago beats and the pre-existing Urbana citywide area), and **183,115** occupied grid cells. Chicago was already represented in the jurisdiction footprint. The statewide directory is a separate view of the same reporting year. Its total must never be added to the map total.

## Reproducing the aggregates

The upload audit uses standard-library Python 3.11+. Prepare a local JSON manifest of seven objects with `family`, `txt` and `xlsx` fields. Use three statewide pairs, three CPD pairs and one Lake Bluff pair. The ingest audit checks all fourteen files, validates schemas and compares both formats. Keep source files outside the checkout.

```sh
python scripts/audit-illinois-2025.py --manifest ../illinois-manifest.json --out ../illinois-review
python scripts/build-illinois-2025.py --manifest ../illinois-manifest.json --boundaries ../chicago-police-beats.geojson --report ../2025-traffic-stops-part-ii.pdf --out ../illinois-derived
python scripts/test-illinois-2025.py
npm test
npm run build
```

The second command requires PyMuPDF and the exact official report and GeoJSON snapshots. It validates their checksums, reconciles every CPD beat-month to the audit, and aborts on a missing or ambiguous ordinary beat. Compare the two derived files to `public/data/illinois-2025/agencies.json` and `data/stop-heat/reviewed-beats/cpd_2025.json` (the full-precision reviewed copy; the app ships a simplified copy in `public/data/stop-heat/beats/`, see [Stop History performance](stop-heat-performance.md)). The latter includes only a public boundary, aggregate counters and four-hour/weekday buckets for each beat. The regular complete map build validates and reindexes these aggregates. A selected-source build stays scoped to its explicit selection.

The original counts-only review receipts in `docs/data/illinois-2025/` describe the input audit before mapping. Two full real-file audits produced identical counts. Raw personal attributes, exact stop times, individual stop identifiers and individual fingerprints are excluded from the repository and app. The committed map tests reconcile all tile and polygon counters to the manifest and check both Illinois views.

## Test and release status

Changes on this feature branch can be tested independently. The main branch triggers public website and rolling Android debug releases. Google Play testing is a separate release action.

## Springfield and Champaign 2025 shading

On 2026-11-16 the statewide extracts were recounted for four municipal agencies and compared with `public/data/illinois-2025/agencies.json`. File 1 was a four-city filtered slice (`idot1_four_cities.txt`) of `2025 Traffic Data 1 Redacted .txt`; its SHA-256 does not match the full-file audit receipt. Files 2A and 2B matched the audit SHA-256 values. Agency totals still match the directory: Springfield 9,934, Champaign 4,701, Urbana 1,775, and Decatur 5,245.

Springfield Police (code 13805) uses location codes 100–800 only. Those eight codes match the City of Springfield `SPD/Beat` FeatureServer layer 0 field `BEAT` one-to-one, so all 9,934 rows are shaded as ordinary Stop History beats in `public/data/stop-heat/beats/spd_2025.json` (full-precision reviewed boundaries: `data/stop-heat/reviewed-beats/spd_2025.json`).

Champaign Police (code 13111) location codes are district abbreviations, not the numbered Police Beats layer. They were matched to the City of Champaign Police Districts MapServer layer 26 field `District` with a case-insensitive exact comparison only:

- CHN → North
- CHS → South
- CHNW → Northwest
- CHSW → Southwest

That includes mixed-case variants such as `chs` and `cHN`. 4,691 rows are shaded in `public/data/stop-heat/beats/champaign_2025.json` (full-precision reviewed boundaries: `data/stop-heat/reviewed-beats/champaign_2025.json`). The remaining 10 rows (CHW 2, 740, 796, CHNNW, CNW, S, SHW, URBANA, Urb) are listed under “Listed, not shaded” and are not guessed.

Urbana Police (code 13100) mostly uses beats 61–65 (1,769 rows) with six other codes on 6 rows. Decatur Police (code 13588) uses 801–810 on every row. Those codes are recorded, but no free public boundary file is available, so they are not shaded.

Reproduce the city aggregates, with the raw TXT files kept outside the checkout:

```sh
python scripts/build-illinois-2025-cities.py --file1-slice ../idot1_four_cities.txt --file2a "../2025 Traffic Data 2A Redacted .txt" --file2b "../2025 Traffic Data 2B Redacted.txt" --springfield-boundaries ../springfield-police-beats.geojson --champaign-boundaries ../champaign-police-districts.geojson --out ../illinois-city-derived
python scripts/test-illinois-2025.py
npm test
```

The committed boundary snapshots in `docs/data/illinois-2025/` keep only geography fields. Officer name, email and phone from the Champaign district download were not stored.
