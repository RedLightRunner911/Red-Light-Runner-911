# Stop History performance and scan service audit (2026-11-17)

Two recommendations were reviewed against the code: harden the background scan's foreground service, and slice the Stop History GeoJSON with geojson-vt. This page records what already existed, what changed, and how it was measured.

## Foreground service (ScanService)

Already in place before this change, and left as is:

- `ScanService` is a real foreground service. `ContextCompat.startForegroundService` starts it, and `ServiceCompat.startForeground` runs first in `onStartCommand`.
- The manifest declares `foregroundServiceType="connectedDevice|location"` and the matching `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE` and `FOREGROUND_SERVICE_LOCATION` permissions. The `location` type is added at runtime only when fine location is granted, so Android 14+ doesn't refuse the start.
- The notification is ongoing and silent, with no sound, vibration or badge, and it opens the app when tapped. It uses channel `patrol_scan_v2` with `IMPORTANCE_DEFAULT` plus `setSilent(true)`. That choice is deliberate: the older `IMPORTANCE_LOW` channel was hidden on some Android 7–11 OEM builds, which hid the only sign that a scan was running. It is kept.
- A partial wake lock and a session limit both cap a session at 6 hours. The 1.0.23 supervisor watches for stalls, restarts the scan every 4 minutes, and falls back to a filtered scan with the screen off. `START_NOT_STICKY` means the app never starts scanning silently after the OS kills it.
- The battery-optimisation settings link opens `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` and needs no permission. This change does not touch it.

Changed: `setForegroundServiceBehavior(FOREGROUND_SERVICE_IMMEDIATE)`. On Android 12+ the system may otherwise hold back a new foreground-service notification for about 10 seconds. The scan, its filters and the supervisor are unchanged.

Not added: `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. Google Play only allows it for apps whose core function breaks under Doze, such as companion apps for the user's own paired device, and reviews it against that list. A passive scanner for other people's devices isn't a clear fit, and a foreground service already keeps BLE scanning alive in Doze.

## Stop History map data

### Before

| What | Size | Shape |
| --- | --- | --- |
| Beat and district polygons (4 files) | 4.05 MB | 287 features, 99,282 vertices, 14–16 decimal places |
| 150 m cell tiles (645 files, 0.25°) | 70.2 MB total, largest 9.25 MB | 183,115 cells |

- Every beat file loaded when Stop History turned on, wherever the user was. Springfield users downloaded all of Chicago's beats (2.96 MB).
- Cell tiles already loaded per viewport at zoom 11 and up, with 1,800 cells drawn at most. The tile cache was never trimmed, though. One dense tile (11,824 cells) takes about 37.6 MB of JS heap once parsed (measured in Node), so panning around Chicago or DC kept piling up hundreds of MB.
- Every redraw rebuilt each cell's outcome table just to read the total. That made counting about 10x slower: 31.5 ms vs 3.4 ms per pass over the largest tile in Node.

### Changes

1. **Build-time simplification** (`scripts/stop-heat-simplify.mjs`, `scripts/optimize-stop-heat-beats.mjs`). Douglas–Peucker runs at 1e-5° (about 1.1 m, under a pixel up to about zoom 17), and coordinates are rounded to 5 decimals. It is topology-aware, so an edge two beats share is simplified once between fixed junctions and both beats keep the same vertices. That leaves no gaps or overlaps between Chicago beats. Counts, buckets and properties stay byte-identical. The full-precision boundaries move to `data/stop-heat/reviewed-beats/`, which isn't shipped, and the reviewed-aggregate digests in `illinois-2025-coverage.mjs` now read from there.
2. **Per-viewport beat files.** `index.json` gains `beatBounds`, and the map fetches only the files that overlap the view. An index without `beatBounds` still loads every file.
3. **Bounded tile cache.** Least-recently-used tiles are dropped once the cache holds more than 12 tiles or 30,000 cells. Tiles on screen are never dropped.
4. **Cheaper redraws.** Per-cell totals are memoised for each tile and filter, so panning with the same filter costs no recount. Beats are counted once per draw, not three times, and no outcome table is built.

### After

| What | Before | After |
| --- | --- | --- |
| Beat files, raw bytes | 4,046,857 | 544,129 (−87%) |
| Beat vertices | 99,282 | 18,235 (−82%) |
| Stop History transfer on first load, Chicago (gzip, `vite preview`) | 3.10 MB | 1.90 MB, nearly all the one cell tile in view |
| Stop History transfer on first load, Springfield | 1.31 MB | 45 KB |
| Pan redraw, Chicago zoom 12, 3 tiles, SVG (headless Chrome, 4x CPU throttle, median) | ~270 ms | ~175 ms |
| First draw, same setup | ~390 ms | ~280 ms |

The tables above count all 4 beat files. Per city: Chicago went from 2,955,388 to 401,402 bytes (71,504 to 11,949 vertices), Springfield from 768,916 to 110,260 bytes (19,552 to 5,065 vertices), and Champaign from 311,209 to 21,144 bytes (7,902 to 898 vertices).

Screenshots of the v2 map before and after, at the same Chicago position, look the same. That pass still had a lighter all-period preview. Stop History shading is now included with Pro and is not drawn without it.

### Why not geojson-vt or a server

- The 3D/vector map (MapLibre, the v2 default) already turns GeoJSON sources into tiles internally, using geojson-vt, so adding geojson-vt there would do the same work twice.
- The 2D Leaflet view has no native vector tiles. Its cost now comes from Leaflet building up to 1,800 SVG cell paths. A canvas renderer measured only about 10% faster, which isn't worth the pane and hit-testing risk.
- Serving pre-sliced tiles from the crowd API would add hosting, cost and an online dependency to data the app already ships offline. The data is already in static 0.25° tiles.
- Remaining follow-up: shrink the largest cell tiles. Dense DC and Chicago tiles carry long per-cell year, time-of-day and weekday bucket arrays. Splitting by year or using a binary encoding would mean a data-format change and a re-review.
