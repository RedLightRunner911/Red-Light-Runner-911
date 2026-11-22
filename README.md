# Police Radar (free, private, receive-only)

Police Radar is a free Android app and web app that listens **passively** for Bluetooth Low Energy signals from public-safety equipment, such as body cameras and in-car gear, and shows them on a map. It never connects to or pairs with any device.

This version is a modified fork of **Patrol Radar** by [missionaryj](https://github.com/missionaryj). Changes in this fork: every feature is free (no subscription or Google Play Billing), the crowd map and city chat are switched off, nothing is uploaded, scanning runs only during a session you start, and the app has a new name and icon.

## Build your own copy (Android APK)

The Android app is built by GitHub Actions. You do not need Android Studio.

1. **Copy the repository** to your own GitHub account.
2. **Add two repository variables:** go to *Settings → Secrets and variables → Actions → Variables* and add:

   | Name | Value | Required? |
   |---|---|---|
   | `APP_ID` | Your app ID, for example `com.yourname.policeradar`. Lowercase, dots between parts, no part starting with a number. It cannot be changed after you publish to Google Play. | Optional for testing. Without it, builds use the placeholder `com.example.policeradar`, which cannot be published. |
   | `VITE_MAPBOX_PUBLIC_TOKEN` | Your own Mapbox **public** token (starts with `pk.`). Free account at mapbox.com → Account → Tokens. Usage counts against your Mapbox account. | Needed for destination search and navigation. The main map works without it. |

3. **Turn on Actions** in the *Actions* tab if GitHub asks.
4. **Build:** *Actions → Android APK → Run workflow*. When the `apk` job finishes, download the APK from the run's *Artifacts* section and install it on your phone. The `aab` job (signed Play Store bundle) fails unless you add your own upload signing key as secrets; that is expected for testing.

### Privacy in this fork
- No accounts, analytics, crowd sharing or chat. Detections stay on the phone.
- Location and Bluetooth are used while the app is open or while a scan you started is running. A notification with a **Stop** button shows whenever scanning runs in the background, and closing the app stops it.
- Map tiles, address search and navigation contact third-party map services (OpenFreeMap / OpenStreetMap, Photon, Mapbox).

### Regenerating the icon
Edit `resources/make_icons.py`, then run `pip install cairosvg pillow` and `python resources/make_icons.py` from the repo root.

## Quick start
```bash
npm install
npm run dev     # open the printed URL; it redirects to /v2/index.html. Mock backend is the default
npm run build
```
Mock mode sends simulated advertisements, including non-matching "noise", every 1.5 s. The demo points are scattered around your coarse location, or around Chicago if geolocation is denied.

### Real BLE (experimental)
- Use Chrome on Android or desktop over HTTPS or localhost, and enable `chrome://flags/#enable-experimental-web-platform-features`. That turns on `navigator.bluetooth.requestLEScan`, which scans continuously.
- Without the flag, the app falls back to `requestDevice({acceptAllDevices})` plus `watchAdvertisements()`. That only watches **one device you pick by hand**, so it is a demo rather than a detector.
- iOS Safari has no Web Bluetooth. For reliable background scanning you need a native wrapper (Capacitor + a BLE plugin).

## Interface
The only UI is `v2/index.html` (`src/v2/main.ts`). The site root (`index.html`) redirects to that document and keeps the query string and hash, so `/v2/` bookmarks and links such as `?backend=`, `?notour=1`, `#settings`, and `#chat` still open the same page. The Android app still starts at `/v2/index.html`. Shared scanning, map, and fusion code stays in `src/`.

## Architecture
```
src/ble/       Scanner interface, MockScanner, WebBluetoothScanner, signatures.ts (data-driven), matcher.ts
src/map/       Leaflet MapView (decay rendering), coarsen() ~150 m grid
src/reports/   Report type, LocalReportStore (localStorage, 15 min TTL), ReportBackend interface + NotImplementedBackend
src/util/      ephemeralId(): salted per-session SHA-256 → 8 hex chars
docs/          scanner-streams.md
```
`match(adv)` returns `{signature, confidence, rssi, timestamp, sessionId}`. Independent hits are fused with 1−Π(1−c). Every signature is flagged **"unverified, needs field validation"**.

## Passive-only and privacy design
- **Receive-only.** The app never connects, pairs, reads or writes GATT, or probes devices.
- MACs, device IDs, and serials are never stored or shown. Only a salted hash is kept, and the salt changes every page load.
- Locations are rounded to about 150 m. Detections fade out and expire after 15 minutes, and nothing leaves the device.
- Any future shared or crowdsourced map **must** aggregate, coarsen, and delay data before showing it. It must not identify or track individual officers, and it must not keep a persistent device history.

## Legal notes (not legal advice)
- In the US, federal law generally allows receiving unencrypted public radio. Some states restrict scanners in vehicles or their use while committing a crime. Check your local law.
- Passively receiving BLE advertisements is receive-only, but laws and terms vary by place.
- Don't interfere, jam, spoof, decrypt, or interact with any device or radio system. Doing so may be illegal and is out of scope for this project.
- Third-party feeds such as Broadcastify and OpenMHz have restrictive terms. See [docs/scanner-streams.md](docs/scanner-streams.md).

## Limitations
- BLE range is short, typically tens of meters and up to about 100 m in ideal conditions.
- Web Bluetooth scanning sits behind a flag and is Chrome-only. There is no iOS support.
- Many agencies encrypt their radios, and much equipment doesn't advertise or uses randomized addresses.
- False positives happen: vendor company IDs are shared with civilian products, and the signatures are unverified.
- App stores may restrict or reject apps like this.

## Responsible use
This tool is for awareness and research. It must not be used to harass, follow, target, obstruct, or endanger officers or anyone else. Don't build features that identify or track individuals.

## Prior art
[RF Sentinel](https://github.com/CIS-C0/RFSentinel) is an open-source Android app that passively detects body cams, ALPRs, and similar devices over BLE and Wi-Fi, and groups signals into patrol vehicles. Its public signature list informed `signatures.ts`.

## iPhone options (research, not implemented)
- **Bluefy browser:** it doesn't implement `requestLEScan`. It has its own `bluetooth.watchAdvertisements(options)` (added in v3.8.2), which you turn on with Settings → "Enable BLE Advertisements". Supporting it would mean adding a small extra scanner backend. Pages must be served over HTTPS.
- **Capacitor iOS + `@capacitor-community/bluetooth-le`:** `BleClient.requestLEScan` uses CoreBluetooth. In the foreground it reports the local name, manufacturer data, service UUIDs, service data and signal strength (RSSI), but never the MAC address. iOS also needs a `dataPrefix` in manufacturer-data filters.
  - Background scanning requires `UIBackgroundModes: bluetooth-central` plus a service-UUID filter. It is throttled, gives only one event per device, and the plugin can't resume a scan after iOS suspends the app.
  - To build it you need a Mac with Xcode. A free Apple ID can sideload the app onto your own phone, but the signature expires after 7 days. A paid account ($99/yr) is needed for TestFlight or the App Store.

Run the tests with `npm test`.

## Shared crowd map (opt-in)
v2 Settings → "Share police-gear hits to the crowd map" (off by default). Uploads only `{cell (~200 m grid), bucket (5 min), kind, conf (low/med/high), reporter (random per-session token)}` to `https://patrol-radar-api.vercel.app/api/crowd` (source in `crowd-api/`, protocol in `src/crowd/protocol.ts`). Public reads are aggregated, ≥12 min delayed, expire after 2 h; a cell is "confirmed" with ≥2 distinct reporters or high confidence. Storage: Upstash Redis if `UPSTASH_REDIS_REST_URL/TOKEN` (or `KV_REST_API_URL/TOKEN`) are set, else ephemeral memory.

## Historical stop heat
Stop History shading on the map is included with Patrol Radar Pro. `public/data/stop-heat/` contains visual-only 150 m cells of **historical source records**, with event-ID deduplication where available. The audited snapshot has records in six states; it does not provide nationwide coverage or independently verified encounter uniqueness for OPP. Build a review copy with `node scripts/fetch-stop-heat.mjs --cache ../stop-heat-cache --out ../stop-heat-review`; raw caches must stay outside the checkout. Counts only, without personal fields or precise stop points. See [the audit and refresh process](docs/stop-heat.md) and [nationwide research gaps](docs/stop-heat-research.md).

## Flock camera (mapped) layer
`public/data/flock/` holds US Flock ALPR nodes from OpenStreetMap (`surveillance:type=ALPR` + `manufacturer`/`brand` ~ Flock, the tags DeFlock.me uses), split into 5° tiles plus `index.json`. Refresh with `node scripts/fetch-flock.mjs` (Overpass API). Data © OpenStreetMap contributors, ODbL 1.0.
