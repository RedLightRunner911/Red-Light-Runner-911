import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_DIGITS, DEFAULT_TOLERANCE_DEG, collectionBounds, maxDecimals, optimizeBeatCollection, simplifyChain, vertexCount } from './stop-heat-simplify.mjs';
import { optimizeStopHeatDir } from './optimize-stop-heat-beats.mjs';

const pub = (p) => JSON.parse(readFileSync(new URL(`../public/data/stop-heat/${p}`, import.meta.url), 'utf8'));
const reviewed = (p) => JSON.parse(readFileSync(new URL(`../data/stop-heat/reviewed-beats/${p}`, import.meta.url), 'utf8'));
const rings = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat();

function distToRing(p, ring, kx) {
    let best = Infinity;
    for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
        const dx = (bx - ax) * kx, dy = by - ay, px = (p[0] - ax) * kx, py = p[1] - ay;
        const len = dx * dx + dy * dy; const t = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0;
        best = Math.min(best, Math.hypot(t * dx - px, t * dy - py));
    }
    return best;
}

describe('stop-heat beat simplification', () => {
    it('keeps chain endpoints and drops collinear points', () => {
        expect(simplifyChain([[0, 0], [1, 0.000001], [2, 0], [3, 1]], 0.001)).toEqual([[0, 0], [2, 0], [3, 1]]);
    });

    it('keeps the edge two neighbours share identical after simplification', () => {
        const edge = Array.from({ length: 50 }, (_, i) => [0.001 * i, 0.0000003 * Math.sin(i)]);
        const a = [[...edge, [0.049, 0.01], [0, 0.01], edge[0]]];
        const b = [[...edge.slice().reverse(), [0, -0.01], [0.049, -0.01], edge[49]]];
        const fc = { type: 'FeatureCollection', features: [a, b].map((coordinates, i) => ({ type: 'Feature', properties: { id: String(i) }, geometry: { type: 'Polygon', coordinates } })) };
        const [sa, sb] = optimizeBeatCollection(fc).features.map(f => f.geometry.coordinates[0]);
        const onEdge = (r) => [...new Set(r.filter(([, y]) => Math.abs(y) < 0.001).map(p => p.join()))].sort();
        expect(onEdge(sa)).toEqual(onEdge(sb));
        expect(onEdge(sa).length).toBeLessThan(50);
    });

    it('ships slim beat files that stay within tolerance of the reviewed boundaries with counts untouched', () => {
        const index = pub('index.json');
        for (const rel of index.beatFiles) {
            const name = rel.split('/')[1];
            const slim = pub(rel), full = reviewed(name);
            expect(maxDecimals(slim)).toBeLessThanOrEqual(DEFAULT_DIGITS);
            expect(slim.features.map(f => f.properties.id)).toEqual(full.features.map(f => f.properties.id));
            slim.features.forEach((f, i) => {
                expect(f.properties.b).toEqual(full.features[i].properties.b);
                expect(f.properties.n).toBe(full.features[i].properties.n);
                expect(f.geometry.type).toBe(full.features[i].geometry.type);
                const fr = rings(full.features[i].geometry), sr = rings(f.geometry);
                expect(sr).toHaveLength(fr.length);
                fr.forEach((ring, k) => {
                    const kx = Math.cos(ring[0][1] * Math.PI / 180);
                    for (let j = 0; j < ring.length; j += 7) expect(distToRing(ring[j], sr[k], kx)).toBeLessThan(DEFAULT_TOLERANCE_DEG + 2e-5);
                    expect(sr[k][0]).toEqual(sr[k][sr[k].length - 1]);
                });
            });
            expect(index.beatBounds[rel]).toEqual(collectionBounds(slim));
        }
        const before = index.beatFiles.reduce((n, rel) => n + vertexCount(reviewed(rel.split('/')[1])), 0);
        const after = index.beatFiles.reduce((n, rel) => n + vertexCount(pub(rel)), 0);
        expect(after).toBeLessThan(before / 4);
    });

    it('is a no-op when re-run on the committed output', async () => {
        const { mkdtempSync, cpSync, readdirSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { tmpdir } = await import('node:os');
        const dir = mkdtempSync(join(tmpdir(), 'heat-'));
        const src = new URL('../public/data/stop-heat/', import.meta.url);
        cpSync(new URL('index.json', src), join(dir, 'index.json'));
        cpSync(new URL('beats/', src), join(dir, 'beats'), { recursive: true });
        optimizeStopHeatDir(dir, () => {});
        expect(readFileSync(join(dir, 'index.json'), 'utf8')).toBe(readFileSync(new URL('index.json', src), 'utf8'));
        for (const f of readdirSync(join(dir, 'beats')))
            expect(readFileSync(join(dir, 'beats', f), 'utf8')).toBe(readFileSync(new URL(`beats/${f}`, src), 'utf8'));
    });

    it('adopts a promoted full-precision rebuild as the new reviewed copy before slimming it', async () => {
        const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { tmpdir } = await import('node:os');
        const dir = mkdtempSync(join(tmpdir(), 'heat-')), rev = join(dir, 'reviewed');
        mkdirSync(join(dir, 'beats'));
        const full = reviewed('spd_2025.json');
        writeFileSync(join(dir, 'beats/spd_2025.json'), JSON.stringify(full));
        writeFileSync(join(dir, 'index.json'), JSON.stringify({ beatFiles: ['beats/spd_2025.json'] }));
        optimizeStopHeatDir(dir, () => {}, rev);
        expect(existsSync(join(rev, 'spd_2025.json'))).toBe(true);
        expect(JSON.parse(readFileSync(join(rev, 'spd_2025.json'), 'utf8'))).toEqual(full);
        expect(readFileSync(join(dir, 'beats/spd_2025.json'), 'utf8')).toBe(JSON.stringify(pub('beats/spd_2025.json')));
    });
});
