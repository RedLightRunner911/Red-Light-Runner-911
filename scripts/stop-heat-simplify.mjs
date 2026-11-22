// Build-time geometry slimming for Stop History beat/district polygons (runtime files only).
// The reviewed full-precision boundaries stay in data/stop-heat/reviewed-beats/ for audits and digests.
// Topology-aware: chains shared by neighbouring beats are simplified once between fixed junctions,
// so adjacent beats keep identical edges (no slivers or gaps). Counts and properties are untouched.

/** ~1.1 m. Under one screen pixel up to about zoom 17, far below a beat's width. */
export const DEFAULT_TOLERANCE_DEG = 0.00001;
/** 5 decimals ≈ 1.1 m. Rounding keeps vertices shared between beats identical. */
export const DEFAULT_DIGITS = 5;

const polysOf = (g) => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const key = (p) => `${p[0]},${p[1]}`;

function segDist2(p, a, b, kx) {
    const ax = a[0] * kx, ay = a[1], bx = b[0] * kx, by = b[1], px = p[0] * kx, py = p[1];
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    return ex * ex + ey * ey;
}

/** Douglas–Peucker on an open chain; endpoints are always kept. kx scales longitude to ground distance. */
export function simplifyChain(pts, tol, kx = 1) {
    if (pts.length <= 2) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]]; const t2 = tol * tol;
    while (stack.length) {
        const [s, e] = stack.pop();
        let max = -1, idx = -1;
        for (let i = s + 1; i < e; i++) { const d = segDist2(pts[i], pts[s], pts[e], kx); if (d > max) { max = d; idx = i; } }
        if (max > t2) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    return pts.filter((_, i) => keep[i]);
}

/** Simplify every ring of a FeatureCollection. Returns a new collection; input is not mutated. */
export function optimizeBeatCollection(fc, { tolerance = DEFAULT_TOLERANCE_DEG, digits = DEFAULT_DIGITS } = {}) {
    const f = 10 ** digits; const r = (n) => Math.round(n * f) / f;
    // Round first so shared vertices compare exactly, then drop consecutive duplicates.
    const rounded = fc.features.map(ft => polysOf(ft.geometry).map(poly => poly.map(ring => {
        const out = [];
        for (const p of ring) { const q = [r(p[0]), r(p[1])]; const l = out[out.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q); }
        return out;
    })));
    const owners = new Map();
    rounded.forEach((polys, i) => { for (const poly of polys) for (const ring of poly) for (const p of ring) {
        const k = key(p); const s = owners.get(k); if (!s) owners.set(k, new Set([i])); else s.add(i);
    } });
    const sig = (p) => [...owners.get(key(p))].sort((a, b) => a - b).join('|');
    const features = fc.features.map((ft, fi) => {
        const polys = rounded[fi].map(poly => poly.map(ring => {
            const n = ring.length - 1; // closed ring: last == first
            if (n < 4) return ring;
            const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
            const kx = Math.cos(lat * Math.PI / 180);
            const fixed = [];
            for (let i = 0; i < n; i++) {
                const s = sig(ring[i]);
                if (s !== sig(ring[(i - 1 + n) % n]) || s !== sig(ring[(i + 1) % n])) fixed.push(i);
            }
            // Untouched rings still need two anchors; pick the extreme points so the shape survives.
            if (fixed.length < 2) {
                let a = 0, b = 0;
                for (let i = 0; i < n; i++) { if (ring[i][0] < ring[a][0]) a = i; if (ring[i][0] > ring[b][0]) b = i; }
                if (a === b) b = (a + Math.floor(n / 2)) % n;
                for (const i of [a, b]) if (!fixed.includes(i)) fixed.push(i);
                fixed.sort((x, y) => x - y);
            }
            const out = [];
            for (let j = 0; j < fixed.length; j++) {
                const s = fixed[j], e = fixed[(j + 1) % fixed.length];
                const chain = [];
                for (let i = s; ; i = (i + 1) % n) { chain.push(ring[i]); if (i === e && chain.length > 1) break; if (chain.length > n + 1) break; }
                const simp = simplifyChain(chain, tolerance, kx);
                out.push(...simp.slice(0, -1));
            }
            out.push(out[0]);
            return out.length >= 4 ? out : ring;
        }));
        const geometry = ft.geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
        const o = { ...ft, geometry };
        if (ft.bbox) o.bbox = ft.bbox.map(r);
        return o;
    });
    return { ...fc, features };
}

/** [west, south, east, north] of a whole collection, from feature bboxes or coordinates. */
export function collectionBounds(fc) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const ft of fc.features) for (const poly of polysOf(ft.geometry)) for (const ring of poly) for (const [x, y] of ring) {
        if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
    }
    return [w, s, e, n];
}

export const vertexCount = (fc) => fc.features.reduce((a, ft) => a + polysOf(ft.geometry).reduce((b, poly) => b + poly.reduce((c, ring) => c + ring.length, 0), 0), 0);
export const maxDecimals = (fc) => {
    let m = 0;
    for (const ft of fc.features) for (const poly of polysOf(ft.geometry)) for (const ring of poly) for (const p of ring) for (const v of p) {
        const s = String(v); const i = s.indexOf('.'); if (i >= 0) m = Math.max(m, s.length - i - 1);
    }
    return m;
};
