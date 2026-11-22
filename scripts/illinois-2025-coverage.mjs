import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { QUARANTINED, SOURCES } from './stop-heat-sources.mjs';

const id = 'cpd_2025';
const beatPath = 'beats/cpd_2025.json';
const report = 'https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/reports/safety/traffic-stop-studies/2025-traffic-stops-part-ii.pdf';
const boundary = 'https://data.cityofchicago.org/resource/n9it-hstw.geojson?$limit=1000';

// The public, audited aggregate doubles as the offline input for standard full rebuilds.
// Source indices are positional, so always assign them using the new build's registry.
export function appendIllinois2025(index, collection = JSON.parse(readFileSync(
    new URL('../data/stop-heat/reviewed-beats/cpd_2025.json', import.meta.url), 'utf8'))) {
    if (index.sources.some(s => s.id === id) || index.beatFiles.includes(beatPath))
        throw Error('Chicago 2025 already included');
    for (const source of index.sources) {
        const owner = SOURCES.find(s => s.id === source.id);
        if (!owner) throw Error('Review unknown source ownership before adding Chicago 2025');
        if (owner.state === 'IL' && source.audit.time_range[0] <= '2025-12-31' && source.audit.time_range[1] >= '2025-01-01')
            throw Error('Review overlapping Illinois source before adding Chicago 2025');
    }
    const features = collection.features;
    const digest = createHash('sha256').update(JSON.stringify(features.map(f =>
        [f.properties.id, f.bbox, f.geometry, f.properties.b]))).digest('hex');
    if (digest !== '2ba679be2899eb515960eaa40c8953cacf0154fef9e93835f58ac6d542d7e296')
        throw Error('Chicago boundaries or counts differ from the reviewed aggregate');
    let mapped = 0;
    for (const { properties: p } of features) {
        const sum = p.b.reduce((n, v, i) => n + (i % 2 ? v : 0), 0);
        if (p.n !== sum) throw Error('Chicago beat count mismatch');
        p.src = [index.sources.length, sum];
        mapped += sum;
    }
    if (mapped !== 222967 || features.length !== 274) throw Error('Chicago coverage mismatch');
    index.beatFiles.push(beatPath);
    index.years = [...new Set([...index.years, 2025])].sort((a, b) => a - b);
    index.sources.push({
        id, name: 'Chicago Police · IDOT 2025 traffic stop study', url: report + '#page=204',
        license: 'Aggregate counts from IDOT traffic records. Boundaries credited to the City of Chicago.',
        license_url: 'https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html',
        disclaimer: 'This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago. The City of Chicago makes no claims as to the content, accuracy, timeliness, or completeness of any of the data provided at this site. The data provided at this site is subject to change at any time. It is understood that the data provided at this site is being used at one\'s own risk.',
        fetched: '2026-11-16', last_updated: null, stops: mapped, mapped, unmapped: 1884,
        audit: { seen: 224851, accepted: mapped, rejected: 1884, duplicate_rows: 0,
            candidate_repeated_rows: 183, time_range: ['2025-01-01', '2025-12-31'] },
        precision: 'Reported beat of stop on the city’s published police beat boundaries.',
        boundary: { url: boundary, sha256: '775a45ea97fd6ef5f95d6b299bec0732556bb6d6ed8d805338ee298387acd468' },
        note: '274 beats. The agency total includes 1,884 outside-city records (code 3100) excluded from shading. Counts retain 183 possible repeat rows because the extract has no unique encounter identifier.'
    });
    index.notMapped = QUARANTINED;
    index.totals.mapped += mapped;
    index.totals.stops += mapped;
    index.totals.unmapped += 1884;
    index.totals.beats += features.length;
    index.disclaimer = index.disclaimer.replace('Chicago collapses identical public stop rows', 'Stanford’s historical Chicago series collapses identical public stop rows')
        + ' Chicago 2025 shows reported counts by police beat. Illinois agency totals include Chicago and do not add to the map total.';
    index.attribution += ' Illinois Department of Transportation, 2025 Traffic Stop Study. Chicago police beat boundaries from the City of Chicago.';
    index.counting_note = index.counting_note.replace('Chicago deduplicates', 'The Stanford Chicago series deduplicates')
        + ' CPD 2025 counts reported rows, including possible repeats.';
    return collection;
}


function featureDigest(features) {
    return createHash('sha256').update(JSON.stringify(features.map(f =>
        [f.properties.id, f.bbox, f.geometry, f.properties.b]))).digest('hex');
}

const REPORT = 'https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/reports/safety/traffic-stop-studies/2025-traffic-stops-part-ii.pdf';
const SPD_BOUNDARY = 'https://maps.springfield.il.us/server/rest/services/SPD/Beat/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson';
const CHAMPAIGN_BOUNDARY = 'https://gisportal.champaignil.gov/ms/rest/services/Open_Data/Open_Data/MapServer/26/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson';

function creditMunicipal2025(index) {
    index.notMapped = QUARANTINED;
    if (!index.disclaimer.includes('Springfield 2025 shows reported counts by police beat')) {
        index.disclaimer = index.disclaimer
            .replace('Illinois agency totals include Chicago and do not add to the map total.',
                'Springfield 2025 shows reported counts by police beat. Champaign 2025 shows reported counts by police district. Illinois agency totals include these agencies and do not add to the map total.');
        if (!index.disclaimer.includes('Springfield 2025 shows reported counts by police beat'))
            index.disclaimer += ' Springfield 2025 shows reported counts by police beat. Champaign 2025 shows reported counts by police district. Illinois agency totals include these agencies and do not add to the map total.';
    }
    if (!index.attribution.includes('Springfield police beat boundaries'))
        index.attribution += ' Springfield police beat boundaries from the City of Springfield. Champaign police district boundaries from the City of Champaign.';
    if (!index.counting_note.includes('Springfield and Champaign 2025 count reported rows'))
        index.counting_note += ' Springfield and Champaign 2025 count reported rows.';
}

export function appendSpringfield2025(index, collection = JSON.parse(readFileSync(
    new URL('../data/stop-heat/reviewed-beats/spd_2025.json', import.meta.url), 'utf8'))) {
    const id = 'spd_2025';
    const beatPath = 'beats/spd_2025.json';
    if (index.sources.some(s => s.id === id) || index.beatFiles.includes(beatPath))
        throw Error('Springfield 2025 already included');
    const features = collection.features;
    if (featureDigest(features) !== '9ea3675444726fb02d6cd2e318122a202518ca265010f0100edcabdc988e51ab')
        throw Error('Springfield boundaries or counts differ from the reviewed aggregate');
    let mapped = 0;
    for (const { properties: p } of features) {
        const sum = p.b.reduce((n, v, i) => n + (i % 2 ? v : 0), 0);
        if (p.n !== sum) throw Error('Springfield beat count mismatch');
        p.src = [index.sources.length, sum];
        mapped += sum;
    }
    if (mapped !== 9934 || features.length !== 8) throw Error('Springfield coverage mismatch');
    index.beatFiles.push(beatPath);
    index.sources.push({
        id, name: 'Springfield Police · IDOT 2025 traffic stop study', url: REPORT + '#page=1228',
        license: 'Aggregate counts from IDOT traffic records. Boundaries from the City of Springfield SPD Beat FeatureServer. No formal license text is published with the layer.',
        fetched: '2026-11-16', last_updated: null, stops: mapped, mapped, unmapped: 0,
        audit: { seen: 9934, accepted: mapped, rejected: 0, duplicate_rows: 0, time_range: ['2025-01-01', '2025-12-31'] },
        precision: 'Reported beat of stop on the city’s published police beat boundaries (BEAT 100–800).',
        boundary: { url: SPD_BOUNDARY, sha256: '6e7efb6b6acb07bb5bdd58eb8899c846c424ae7ed3c0de69583f772c094f6f66',
            retrieved: '2026-11-16' },
        note: '8 beats. All 9,934 Springfield Police rows use codes 100–800 and are shaded. Counts are reported rows; unique encounters were not independently certified.'
    });
    index.totals.mapped += mapped;
    index.totals.stops += mapped;
    index.totals.beats += features.length;
    creditMunicipal2025(index);
    return collection;
}

export function appendChampaign2025(index, collection = JSON.parse(readFileSync(
    new URL('../data/stop-heat/reviewed-beats/champaign_2025.json', import.meta.url), 'utf8'))) {
    const id = 'champaign_2025';
    const beatPath = 'beats/champaign_2025.json';
    if (index.sources.some(s => s.id === id) || index.beatFiles.includes(beatPath))
        throw Error('Champaign 2025 already included');
    const features = collection.features;
    if (featureDigest(features) !== '32f4892e826255bc648bb6da9f92c62043864241d4994047c66cc20b5de5654a')
        throw Error('Champaign boundaries or counts differ from the reviewed aggregate');
    let mapped = 0;
    for (const { properties: p } of features) {
        const sum = p.b.reduce((n, v, i) => n + (i % 2 ? v : 0), 0);
        if (p.n !== sum) throw Error('Champaign district count mismatch');
        p.src = [index.sources.length, sum];
        mapped += sum;
    }
    if (mapped !== 4691 || features.length !== 4) throw Error('Champaign coverage mismatch');
    index.beatFiles.push(beatPath);
    index.sources.push({
        id, name: 'Champaign Police · IDOT 2025 traffic stop study', url: REPORT + '#page=184',
        license: 'Aggregate counts from IDOT traffic records. Boundaries from the City of Champaign open GIS Police Districts layer. No formal license text is published with the layer.',
        license_url: 'https://gis-cityofchampaign.opendata.arcgis.com/',
        fetched: '2026-11-16', last_updated: null, stops: mapped, mapped, unmapped: 10,
        audit: { seen: 4701, accepted: mapped, rejected: 10, duplicate_rows: 0, time_range: ['2025-01-01', '2025-12-31'] },
        precision: 'Reported location code matched with a case-insensitive exact comparison to the city’s published police district name: CHN=North, CHS=South, CHNW=Northwest, CHSW=Southwest.',
        boundary: { url: CHAMPAIGN_BOUNDARY, sha256: '7fffc8949cfd169ae0fcc2e33b95d510c0afc4233178ae5f4747cffd9e20b0ce',
            retrieved: '2026-11-16' },
        note: '4 police districts. 4,691 of 4,701 rows match CHN, CHS, CHNW or CHSW without regard to case, including mixed-case variants. 10 rows do not match and are not shaded. The mapping uses the city’s district names, not an invented geography. Counts are reported rows; unique encounters were not independently certified.'
    });
    index.totals.mapped += mapped;
    index.totals.stops += mapped;
    index.totals.unmapped += 10;
    index.totals.beats += features.length;
    creditMunicipal2025(index);
    return collection;
}
