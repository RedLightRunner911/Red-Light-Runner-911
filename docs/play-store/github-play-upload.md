# Upload Patrol Radar to Google Play from GitHub Actions

Package: `io.github.missionaryj.patrolradar`.

The **Android APK** workflow (`.github/workflows/android.yml`) builds the signed release AAB on every non-pull-request run. After the `apk` tests and the `aab` job both succeed, the `play` job uploads that AAB to a **testing track**. It never targets production.

| How the workflow starts | Play track | What happens |
| --- | --- | --- |
| Push to `main` | `internal` | Internal testing. Publishes to internal testers without Send for review. |
| Run workflow, track **internal** (the default) | `internal` | Same as a push. |
| Run workflow, track **alpha** | `alpha` | Closed testing. Held for you to send for review and publish. |
| Run workflow, track **beta** | `beta` | Open testing. Held the same way. |

Alpha and beta run only when you dispatch the workflow and choose that track. A push cannot select them.

Pull requests do not build the signed AAB and do not upload. Forks do not upload. If `PLAY_SERVICE_ACCOUNT_JSON` is missing or blank, the upload step is skipped with a notice and the workflow stays green. The artifact `patrol-radar-release-aab` is still there.

The upload uses [r0adkll/upload-google-play](https://github.com/r0adkll/upload-google-play) **v1.1.5**, commit `e738b9dd8f2476ea806d921b64aacd24f34515a5`. That action uploads to **production** when its `tracks` input is left empty. This workflow rejects an empty track, `production`, `prod`, and any name other than `internal`, `alpha`, or `beta` before the action runs. The GitHub UI has no production option. A push to `main` always uses `internal`.

Release status is **`completed`** on the chosen testing track (every tester on that track, once Play actually publishes it). This is not a staged production rollout. Release notes for every track are the en-US text: "We squashed bugs and improved performance so Patrol Radar is better for you". The ProGuard `mapping.txt` is attached. Native debug symbols are attached when the AAB job produced `native-debug-symbols.zip`.

## Service account

The repository secret `PLAY_SERVICE_ACCOUNT_JSON` is already set. It is the JSON key for `play-release@patrol-radar-billing.iam.gserviceaccount.com`. That account is separate from `play-verifier@patrol-radar-billing.iam.gserviceaccount.com` (the Supabase purchase-verification key). Do not put either private key in the repo, in Android, or in chat.

Play Console access for `play-release` is **this app only** (`io.github.missionaryj.patrolradar`):

- **View app information (read-only)**
- **Release apps to testing tracks**

**Release to production, exclude devices, and use Play App Signing** is not granted. "Release apps to testing tracks" is the permission that creates and rolls out internal, closed, and open testing releases. It cannot publish production. The workflow only calls the testing-track edit APIs (`edits.insert`, bundle upload, `tracks.update` for `internal`, `alpha`, or `beta`, deobfuscation-file upload for `mapping.txt` and native symbols, then `edits.commit`). Those calls are what this permission covers. Internal testing is track id `internal`, so a `main` upload does not need production access or **Manage testing tracks and edit tester lists**. Tester lists stay as they are.

If the secret is removed or blank, the upload step skips with a notice and the workflow stays green. The `patrol-radar-release-aab` artifact is still there. A value that is not a service-account JSON fails the `play` job.

To rotate the key: Google Cloud project linked from Play Console → **Setup → API access** → the `play-release` service account → **Keys → Add key → JSON**. Replace the repository secret with the new file contents, including the braces, and delete the old key. Keep the same two Play Console permissions. A `main` merge is not held for a GitHub reviewer. Alpha and beta are held in Play Console instead.

## Tracks

API track ids, not display names:

- `internal` — Internal testing
- `alpha` — Closed testing → Alpha
- `beta` — Open testing

Open **Test and release → Testing → Internal testing**, **Closed testing → Alpha**, and **Open testing** once so each track exists and has testers or countries saved. If the API says the track was not found, that page has not been set up.

## What you run

**Internal, every merge.** Push to `main`, or Actions → **Android APK** → **Run workflow** → branch **main** → track **internal**. The debug APK is uploaded only as the Actions artifact `patrol-radar-debug-apk`. It is not published to a GitHub Release. Dispatching from a branch other than `main` fails the Play job and does not upload.

**Closed testing.** Run workflow on `main` and choose **alpha**. The workflow does not do this on push.

**Open testing.** Run workflow on `main` and choose **beta**.

Pushes and manual runs share one concurrency group and **queue**. A second push or dispatch waits. It does not cancel an upload that is already calling Play. Pull request runs use a different group and still cancel a superseded pull request run. A pull request cannot cancel a Play upload.

## Review and managed publishing

Managed publishing is on. `r0adkll/upload-google-play` passes `changesNotSentForReview` through to `edits.commit` and fails the step on a 400. It does not retry, and it does not set `changesInReviewBehavior`.

- **Internal.** `changesNotSentForReview` is false. Status is `completed`. Internal testing publishes to the internal tester list without **Send for review**. You pre-approved that.
- **Alpha and beta.** The first commit sets `changesNotSentForReview` true, so the release is added to **Changes not yet sent for review** and is not sent for review. You press both buttons yourself:
  1. Open **Publishing overview**.
  2. Read the whole list under **Changes not yet sent for review**. It can include other waiting edits, not only this AAB.
  3. Click **Send for review** for the changes you intend.
  4. After Google approves them, they sit under **Changes ready to publish** while managed publishing is on. Read that list too. **Publish changes** publishes every change in it.
  5. Click **Publish changes** (the control may say **Go live** or **Publish**). Alpha or Open testers stay on the previous build until that click.

Play returns `Changes are sent for review automatically. The query parameter changesNotSentForReview must not be set.` when the flag is set on an edit that does not need review (this is common for internal, and it also happens for alpha or beta when nothing is waiting on a rejection). The commit did not succeed. The workflow retries that alpha or beta upload **once**, without the flag. The job summary says when that retry was used. Check Publishing overview: Play may have sent that edit for review on its own. The retry does **not** run for other errors (version code, permissions, an unknown track), so a failed alpha upload is not silently sent for review.

The opposite error, `Please set the query parameter changesNotSentForReview to true`, means Play refused to commit unless the hold is set. The workflow does not flip an internal upload onto that hold. The edit is not committed.

The pinned action does not pass `changesInReviewBehavior`. If a review is already open, Play's default for a commit without that parameter is `CANCEL_IN_REVIEW_AND_SUBMIT`, which can cancel the open review. Check Publishing overview after an internal upload that lands while an Alpha or Open testing review is in progress.

## versionName and versionCode

`versionName` is `version` in `package.json`. Gradle reads it when `VERSION_NAME` is unset. The merge that adds this upload ships **1.0.34**. Bump `package.json` again before a later release you want testers to see as a new version name. The workflow does not bump it on its own. Play will still accept a new versionCode with an unchanged versionName.

`versionCode` is `github.run_number` for this workflow file, passed as `VERSION_CODE`. As of 18 November 2026, Internal testing and Open testing are at version code **237**. Run numbers **above 239** are ahead of that. Gaps are normal: pull requests, failed runs, and dispatches all increment the number, and Play allows unused codes.

Play rejects a code that is not strictly greater than every code already uploaded, including drafts, halted releases, and releases in review.

- A **re-run of the same workflow run** reuses the run number. If that attempt already committed the code, the re-run fails. Start a new run. Re-running failed jobs is safe only when the earlier attempt did not commit the edit.
- A **manual upload** above the current run number blocks CI until the run number passes it.
- **Renaming or replacing** `.github/workflows/android.yml` can restart the run number at 1. Keep this file path.
- An alpha or beta dispatch uses a new run number, higher than earlier internal builds of older runs.

## What a green `play` job means

- **Notice "Google Play upload skipped".** The secret is unset. Nothing was sent to Play.
- **Job failed on "Refusing Play track".** The track was production, empty, or not `internal`, `alpha`, or `beta`. Nothing was uploaded.
- **Internal success.** Play accepted the internal release. Internal testers can install it without Send for review.
- **Alpha or beta success, review hold true.** The bundle is in Publishing overview and was not sent for review. You still click **Send for review** and, after approval, **Publish changes**.
- **Alpha or beta success, retried.** Play refused the review hold. The summary says so. Check Publishing overview before telling testers anything.

## When the API rejects the upload

- **401 / 403.** The API is not enabled, the JSON is the wrong project, or the Play Console permission has not applied. Missing production permission is not the cause of a testing-track 403.
- **Package not found.** The app must already exist in Play Console. It does.
- **Version code has already been used.** Use a new run. See above.
- **Track not found.** The id must be `internal`, `alpha`, or `beta`, and that testing page must have been opened once.
- **changesNotSentForReview must not be set.** Alpha and beta retry once without the flag. Internal does not set the flag. If it still fails, the edit was not committed.
- **Please set changesNotSentForReview to true.** Play would not commit without the hold. Nothing was published.
- **Edit in progress / precondition check failed.** A draft edit is open in Play Console, or another client committed first. Finish or discard that draft, then start a **new** Actions run if the version code was already consumed.

## Manual fallback

Download artifact `patrol-radar-release-aab` from a successful `main` run, unzip `patrol-radar-release.aab`, and upload it in Play Console to Internal, Closed testing → Alpha, or Open testing. Do not upload the debug APK. Do not create a production release.
