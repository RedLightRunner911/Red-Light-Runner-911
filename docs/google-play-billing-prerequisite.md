# Google Play Billing prerequisite (not a checkout implementation)

The Android app includes the Google Play Billing Library `9.1.0` in `android/app/build.gradle` so a signed Android App Bundle can be recognized as billing-capable by Google Play Console. The dependency contributes `com.android.vending.BILLING` through Android manifest merging.

**This is not an active purchase implementation.** There is no billing client, purchase flow, unlock, receipt handling, or test subscription in this PR. The planned `patrol_radar_pro` subscription (monthly base plan, **$1.99 USD/month**) must remain customer-inactive until proper native purchase and restore handling, secure server-side verification, and lifecycle/revocation tests are in place.

## Safe next steps

1. On this PR, check `npm test`, `npm run build` and Android `testDebugUnitTest assembleDebug` in CI; inspect the merged Android manifest to confirm the BILLING permission and billing library metadata.
2. Once this isolated PR is reviewed and merged **with explicit approval**, the Android APK workflow on `main` builds a signed release `.aab`. Its `versionCode` is the GitHub Actions run number for that workflow. Confirm the code is higher than every bundle already uploaded to package `io.github.missionaryj.patrolradar`, including other tracks and releases in review. See `docs/play-store/github-play-upload.md`.
3. That workflow uploads the AAB to a testing track only. A `main` push goes to Internal testing (`internal`). Closed testing (`alpha`) and Open testing (`beta`) are Run workflow choices. Do not upload the debug APK. The workflow rejects the production track. Bump `package.json` `version` for the release name. See `docs/play-store/github-play-upload.md`.
4. In Play Console, return to **Monetize with Play → Products → Subscriptions** and create product `patrol_radar_pro` and auto-renewing base plan `monthly` priced at **$1.99 USD**. Check merchant profile and product availability; don't enable customer-facing sales.
5. Implement real Play Billing via a separate PR and a trusted backend verifier using Google Play Developer API, with test-account purchase/renewal/cancellation/refund/restore flows. Ensure Pro access cannot be obtained by editing local storage or a web UI flag, and determine how paid historical datasets will be controlled before marketing data access as exclusive.

The current Stop History Pro preview UI lives separately in draft PR #26. This prerequisite PR can be reviewed independently and should not automatically merge or release PR #26.
