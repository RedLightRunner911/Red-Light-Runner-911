#!/usr/bin/env node
// Writes the slim runtime beat files the app ships, plus per-file bounds so the map only fetches
// the beat files that overlap the screen. Run after any Stop History rebuild:
//   node scripts/optimize-stop-heat-beats.mjs [public/data/stop-heat]
// Geometry comes from data/stop-heat/reviewed-beats/<name>.json (full precision, kept for audits
// and the reviewed-aggregate digests). Properties (counts, buckets, source index) come from the
// current runtime file when it exists, so a rebuild's reindexed `src` values are kept.
// A full-precision runtime file (fresh from build-verified-stop-heat.mjs) is first saved as the new
// reviewed copy, so a promoted rebuild never gets paired with stale boundaries.
// Idempotent: the same inputs always give byte-identical output.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DIGITS, collectionBounds, maxDecimals, optimizeBeatCollection, vertexCount } from './stop-heat-simplify.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const REVIEWED_DIR = join(root, 'data/stop-heat/reviewed-beats');

export function optimizeStopHeatDir(dir = join(root, 'public/data/stop-heat'), log = console.log, reviewedDir = REVIEWED_DIR) {
    const indexPath = join(dir, 'index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const beatBounds = {};
    for (const rel of index.beatFiles ?? []) {
        const out = join(dir, rel);
        const reviewed = join(reviewedDir, basename(rel));
        let current = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined;
        if (current && maxDecimals(current) > DEFAULT_DIGITS) {
            mkdirSync(reviewedDir, { recursive: true });
            writeFileSync(reviewed, JSON.stringify(current));
            log(`${rel}: full-precision build output saved as ${reviewed}`);
        }
        if (!existsSync(reviewed)) throw Error(`Missing reviewed boundaries for ${rel}: copy the full-precision file to ${reviewed} first`);
        const src = JSON.parse(readFileSync(reviewed, 'utf8'));
        current ??= src;
        const props = new Map(current.features.map(f => [f.properties.id, f.properties]));
        if (props.size !== src.features.length || src.features.some(f => !props.has(f.properties.id)))
            throw Error(`${rel}: runtime and reviewed files list different beats`);
        const merged = { ...src, features: src.features.map(f => ({ ...f, properties: props.get(f.properties.id) })) };
        const slim = optimizeBeatCollection(merged);
        const before = Buffer.byteLength(JSON.stringify(src)), text = JSON.stringify(slim);
        writeFileSync(out, text);
        beatBounds[rel] = collectionBounds(slim);
        log(`${rel}: ${before.toLocaleString()} → ${Buffer.byteLength(text).toLocaleString()} bytes, ${vertexCount(src).toLocaleString()} → ${vertexCount(slim).toLocaleString()} vertices`);
    }
    index.beatBounds = beatBounds;
    writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
    return beatBounds;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    optimizeStopHeatDir(process.argv[2] ? resolve(process.argv[2]) : undefined);
