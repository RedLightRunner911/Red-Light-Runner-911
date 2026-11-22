# Data safety form answers

Paste these into Play Console → App content → Data safety. They match the app as of version 1.0.37.

Overview
- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes** (HTTPS only; Android mixed content is disabled)
- Do you provide a way for users to request that their data is deleted? **Yes**
- Deletion URL: https://missionaryj.github.io/patrol-radar/privacy/
- Account creation: the app can create an anonymous Supabase account for City Chat and a separate anonymous account for Play purchase verification. No email, phone, or password. Users can request deletion of those accounts at percolatorbiz@gmail.com.

"Collected" means transmitted off the device. "Shared" means transferred to a third party that is not only processing it on our instructions. Supabase, Vercel, and Upstash are service providers (collected, not shared). OpenStreetMap, OpenFreeMap, Mapbox, and Photon (Komoot) receive data to provide their own service (shared).

| Play data type | Collected | Shared | Processed ephemerally? | Required or optional | Purpose |
|---|---|---|---|---|---|
| Location → Approximate location | Yes | Yes | No | Optional for the crowd map. Map tiles are sent whenever the map is shown. | App functionality |
| Location → Precise location | Yes | Yes | We do not keep the route. Mapbox and Photon keep data under their own policies. | Optional. Only Navigation Mode and place search. | App functionality |
| Financial info → Purchase history | Yes | No | No | Optional. Only if the user starts or restores Pro. | App functionality; Fraud prevention, security, and compliance |
| Financial info → User payment info (card, bank) | No | No | — | — | Google Play collects payment details. The app never sees the card. |
| Messages → Other in-app messages | Yes | No | No | Optional. City Chat is off until opened. | App functionality; Fraud prevention, security, and compliance |
| Device or other IDs | Yes | No | No | The Play account hash and install time are sent when Pro or founder restore runs. The anonymous account id is created when chat or Pro verification is used. | App functionality; Fraud prevention, security, and compliance |
| Personal info (name, email, phone, address) | No | No | — | — | — |
| App activity, App info and performance, Photos, Audio, Files and docs, Contacts, Calendar, Health, Web browsing | No | No | — | — | — |

What is actually sent
- Approximate location: if the user opts in, `https://patrol-radar-api.vercel.app/api/crowd` receives a coarse grid cell (about 150–250 m), a 5-minute bucket, gear category, confidence, and a random session id that resets when sharing is turned off. Reports expire after about 2 hours. The server may store an hourly-salted IP hash for rate limits and does not keep the raw IP. Storage is Upstash Redis when that project is configured, otherwise process memory. Vercel and Upstash are service providers.
- Map tiles: 2D tiles are loaded from `tile.openstreetmap.org`. 3D vector tiles and fonts are loaded from `tiles.openfreemap.org` (OpenFreeMap, OpenMapTiles schema, OpenStreetMap data). Those hosts see the requester's IP and the tiles for the area on screen.
- Precise location: place search calls `photon.komoot.io` with the query and a location bias. Driving routes call Mapbox Directions (`api.mapbox.com`) with the start and destination. An active Navigation Mode trip lets the Mapbox Navigation SDK send location to Mapbox for routing, traffic, and map matching. Bluetooth and Wi-Fi observations are not attached to those requests.
- Purchase history: the Play purchase token and the anonymous Pro account id are sent over HTTPS to the Supabase Edge Function `pro-entitlement`. The server stores the token, a SHA-256 of the token, product id, subscription state, expiry, and verification time. Real-time developer notifications are re-checked with the Google Play Developer API. A free trial is an active subscription until Google's expiry time. Payment cards stay with Google Play.
- Device or other IDs: SHA-256 of a fixed salt plus the app-scoped ANDROID_ID (never the raw id) is set as Play's obfuscated account id and sent to the verifier. The app can also send `PackageInfo.firstInstallTime`. Automatic founder grants from that time are off unless the server flag `FOUNDER_AUTO_CLAIM` is enabled. City Chat and Pro each use an anonymous Supabase user id. These are not linked to a name, email, or phone.
- Messages: City Chat stores the text, time, city-room name (computed on the phone, for example `US-IL-champaign`), a server-generated daily handle, and the anonymous id. Messages last 24 hours. Reported messages can last 7 days. Users can delete their own messages. Supabase is the service provider.
- Bluetooth scan results and Wi-Fi rule matches stay on the device. A debug export is created only when the user chooses to share a file. That file is not uploaded by the app.
- There is no ads SDK and no analytics SDK. `google-services.json` is not in the app.

Deletion
- On the device: clear the session in the app, or uninstall. Android backup is disabled.
- Crowd reports expire in about 2 hours and are not linked to a person.
- Chat: the Delete control, then automatic deletion. For the anonymous account, email percolatorbiz@gmail.com.
- Pro records: email the same address. Records needed for fraud, refunds, or legal duties may be kept. Deleting app data does not cancel the Google Play subscription. Cancellation is at https://play.google.com/store/account/subscriptions.

Also complete App content → User-generated content for City Chat: users can report messages and users and block users, and must accept the chat rules before posting.

## Foreground services

Declare every service below under App content → Foreground service permissions. The release build merges the app manifest with Mapbox Navigation SDK `com.mapbox.navigationcore:android-ndk27` (namespace `com.mapbox.navigation.core`). That SDK manifest declares one foreground service. The app declares the other. No other foreground service is declared in those manifests.

### 1. `io.github.missionaryj.patrolradar.ScanService`

Manifest: `android:foregroundServiceType="connectedDevice|location"`. The location type is added at runtime only when fine location is granted. The app does not request `ACCESS_BACKGROUND_LOCATION`.

Play type **Connected device** (FOREGROUND_SERVICE_CONNECTED_DEVICE)

> Patrol Radar's ScanService runs a user-started Bluetooth Low Energy scan for public-safety equipment advertisements while the screen is off. The scan never connects to, pairs with, or writes to another device. It starts only when the user taps Scan, posts the persistent notification "Patrol Radar is scanning", and stops when the user taps Stop or after 6 hours. Stopping the service would end detection for that session.

Play type **Location** (FOREGROUND_SERVICE_LOCATION), same service

> While that scan is running, ScanService holds a GPS fix so each detection can be drawn on the user's map and snapped to a coarse 150–250 m grid. This service does not upload the precise fix. Precise coordinates are sent only if the user separately starts Navigation Mode or place search, or opts in to the coarse crowd map.

### 2. `com.mapbox.navigation.core.trip.service.NavigationNotificationService`

Manifest from the Mapbox Navigation SDK: `android:foregroundServiceType="location"`. It is not exported. It is not used for Bluetooth scanning.

Play type **Location** (FOREGROUND_SERVICE_LOCATION)

> Mapbox's NavigationNotificationService shows the turn-by-turn notification while the user has an active Navigation Mode trip. The user starts it by choosing a destination and stops it by ending the route. The location type lets guidance continue with the screen off. Location for that trip is sent to Mapbox for routing, traffic, and map matching.

Attach a short screen recording that shows Scan start, the scanning notification, the screen locking, and Stop, then a Navigation Mode trip and its notification.
