# Permission & declaration justifications

## Foreground service (Play Console → App content → Foreground service permissions)

The release manifest (app manifest plus Mapbox Navigation SDK `com.mapbox.navigationcore:android-ndk27`, namespace `com.mapbox.navigation.core`) declares two foreground services. Paste the text in `docs/play-store/data-safety.md`.

1. `io.github.missionaryj.patrolradar.ScanService`, types **connectedDevice** and **location** (location is added at runtime only when fine location is granted).
2. `com.mapbox.navigation.core.trip.service.NavigationNotificationService`, type **location**. This is Mapbox's guidance notification. It runs only during Navigation Mode.

Video: screen-record tapping Scan, the scanning notification, locking the screen, and Stop; then start a Navigation Mode trip and show its notification. Do not tell Play that the precise GPS fix never leaves the device. Navigation and place search send coordinates to Mapbox and Photon. The scan service itself does not upload that fix.

## Location permissions
ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION are foreground ("While using the app") only. **ACCESS_BACKGROUND_LOCATION is not requested**, so no background-location declaration is needed. The foreground service is started from the visible activity, which Android counts as while-in-use.

## Bluetooth
BLUETOOTH_SCAN (Android 12+) without `neverForLocation`, because the app derives map location from scans. BLUETOOTH/BLUETOOTH_ADMIN capped at API 30. No BLUETOOTH_CONNECT (never connects).

## Other
POST_NOTIFICATIONS (foreground-service notification), WAKE_LOCK, INTERNET (map tiles, geocoding, opt-in crowd map).
Removed for Play: REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (restricted permission); the in-app button now opens the system battery-optimization list instead.

## Other App content items
- Ads: No ads. Government app: No. Financial features: standard Google Play in-app subscription only (review current Play form; no lending, banking, investing or transfers). Health: No. News: No.
- Account deletion: an anonymous Supabase account is used for City Chat and Pro purchase verification; explain deletion and retained purchase records in privacy policy.
