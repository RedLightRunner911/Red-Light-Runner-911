#!/usr/bin/env bash
# Regression tests for the Play track guard and release-note helper.
# These tests do not contact Google Play.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

script="$root/.github/scripts/resolve-play-track.sh"
repo="missionaryj/patrol-radar"
ref="refs/heads/main"
failures=0

expect_track() {
  local desc="$1" want="$2"
  shift 2
  local got status
  set +e
  got="$("$script" "$@" 2>/tmp/play-track-err)"
  status=$?
  set -e
  if [ "$status" -ne 0 ] || [ "$got" != "$want" ]; then
    echo "FAIL $desc: status=$status want='$want' got='$got' stderr=$(cat /tmp/play-track-err)"
    failures=$((failures + 1))
    return
  fi
  echo "ok $desc -> $got"
}

expect_reject() {
  local desc="$1" needle="$2"
  shift 2
  local status
  set +e
  "$script" "$@" >/tmp/play-track-out 2>/tmp/play-track-err
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "FAIL $desc: expected rejection, stdout=$(cat /tmp/play-track-out)"
    failures=$((failures + 1))
    return
  fi
  if ! grep -q '::error title=Play upload blocked::' /tmp/play-track-err; then
    echo "FAIL $desc: missing error annotation: $(cat /tmp/play-track-err)"
    failures=$((failures + 1))
    return
  fi
  if ! grep -q "$needle" /tmp/play-track-err; then
    echo "FAIL $desc: stderr did not mention '$needle': $(cat /tmp/play-track-err)"
    failures=$((failures + 1))
    return
  fi
  echo "ok $desc rejected"
}

expect_track "push defaults to internal" internal push "" "$repo" "$ref"
expect_track "push ignores an alpha input" internal push alpha "$repo" "$ref"
expect_track "push ignores a beta input" internal push beta "$repo" "$ref"
expect_track "push ignores a production input" internal push production "$repo" "$ref"
expect_track "dispatch internal" internal workflow_dispatch internal "$repo" "$ref"
expect_track "dispatch INTERNAL folds case" internal workflow_dispatch "INTERNAL" "$repo" "$ref"
expect_track "dispatch alpha" alpha workflow_dispatch alpha "$repo" "$ref"
expect_track "dispatch beta" beta workflow_dispatch beta "$repo" "$ref"
expect_track "dispatch BETA folds case" beta workflow_dispatch "BETA" "$repo" "$ref"
expect_track "dispatch trims beta" beta workflow_dispatch "  beta  " "$repo" "$ref"

expect_reject "dispatch production" "cannot target production" workflow_dispatch production "$repo" "$ref"
expect_reject "dispatch Production" "cannot target production" workflow_dispatch "Production" "$repo" "$ref"
expect_reject "dispatch prod" "cannot target production" workflow_dispatch prod "$repo" "$ref"
expect_reject "dispatch spaced production" "cannot target production" workflow_dispatch " production " "$repo" "$ref"
expect_reject "dispatch empty track" "defaults to production" workflow_dispatch "" "$repo" "$ref"
expect_reject "dispatch closed" "not allowed" workflow_dispatch closed "$repo" "$ref"
expect_reject "dispatch alpha,production" "not allowed" workflow_dispatch "alpha,production" "$repo" "$ref"
expect_reject "dispatch beta smashed with production" "not allowed" workflow_dispatch $'beta\nproduction' "$repo" "$ref"
expect_reject "pull request" "pull_request" pull_request alpha "$repo" "$ref"
expect_reject "fork repository" "Only missionaryj/patrol-radar" push "" "someone/patrol-radar" "$ref"
expect_reject "non-main ref" "refs/heads/main" workflow_dispatch beta "$repo" "refs/heads/feature"
expect_reject "unknown event" "cannot upload" schedule "" "$repo" "$ref"

workflow="$root/.github/workflows/android.yml"
if ! grep -F "TRACK: \${{ steps.track.outputs.track }}" "$workflow" >/dev/null; then
  echo "FAIL workflow does not pass the resolved track into the upload step"
  failures=$((failures + 1))
else
  echo "ok workflow passes the resolved track"
fi
if ! grep -q "cancel-in-progress: \${{ github.event_name == 'pull_request' }}" "$workflow"; then
  echo "FAIL release runs can still cancel an in-progress Play upload"
  failures=$((failures + 1))
else
  echo "ok only pull requests cancel in-progress runs"
fi
if grep -Eq 'tracks:[[:space:]]*production|track:[[:space:]]*production' "$workflow"; then
  echo "FAIL workflow hardcodes the production track"
  failures=$((failures + 1))
else
  echo "ok workflow does not hardcode production"
fi
if ! grep -F "VERSION_CODE: \${{ github.run_number }}" "$workflow" >/dev/null; then
  echo "FAIL versionCode is no longer the workflow run number"
  failures=$((failures + 1))
else
  echo "ok versionCode stays the workflow run number"
fi
if ! grep -q "if: github.event_name != 'pull_request'" "$workflow"; then
  echo "FAIL aab job pull_request guard missing"
  failures=$((failures + 1))
else
  echo "ok aab job still skips pull requests"
fi

python3 - <<'PY'
import importlib.util
import pathlib

path = pathlib.Path(".github/scripts/write-play-release-notes.py")
spec = importlib.util.spec_from_file_location("play_notes", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

expected = "We squashed bugs and improved performance so Patrol Radar is better for you"
assert mod.RELEASE_NOTES == expected, mod.RELEASE_NOTES
print("ok release note helper")
PY

tmp="$(mktemp -d)"
PLAY_DIR="$tmp" python3 .github/scripts/write-play-release-notes.py >/tmp/play-notes-log
note_file="$tmp/whatsnew/whatsnew-en-US"
if [ "$(cat "$note_file")" != "We squashed bugs and improved performance so Patrol Radar is better for you" ]; then
  echo "FAIL release notes file contents: $(cat "$note_file")"
  failures=$((failures + 1))
else
  echo "ok release notes file"
fi
rm -rf "$tmp"

# shellcheck disable=SC1091 # path is computed from the repo root
source "$root/.github/scripts/upload-play-release.sh"
if [ "$(defer_review_for_track internal)" != "false" ] || [ "$(defer_review_for_track alpha)" != "true" ] || [ "$(defer_review_for_track beta)" != "true" ]; then
  echo "FAIL defer_review_for_track"
  failures=$((failures + 1))
else
  echo "ok internal publishes immediately and alpha/beta hold for review"
fi
if defer_review_for_track production >/dev/null 2>&1; then
  echo "FAIL production was given a review flag"
  failures=$((failures + 1))
else
  echo "ok production has no review flag"
fi
printf '%s\n' 'Error: Changes are sent for review automatically. The query parameter changesNotSentForReview must not be set.' >/tmp/play-flag-reject.log
printf '%s\n' 'Error: Please set the query parameter changesNotSentForReview to true. Once committed, the changes in this edit can be sent for review from the Google Play Console UI.' >/tmp/play-flag-required.log
printf '%s\n' 'Error: Version code 240 has already been used.' >/tmp/play-flag-other.log
if ! review_flag_rejected /tmp/play-flag-reject.log; then
  echo "FAIL did not recognize the must-not-be-set error"
  failures=$((failures + 1))
else
  echo "ok must-not-be-set error is retryable"
fi
if review_flag_rejected /tmp/play-flag-required.log || review_flag_rejected /tmp/play-flag-other.log; then
  echo "FAIL a non-retryable Play error was treated as the review-flag rejection"
  failures=$((failures + 1))
else
  echo "ok other Play errors are not retried without the review hold"
fi

check_creds="$root/.github/scripts/check-play-service-account.py"
run_creds() {
  local status
  set +e
  PLAY_JSON="$1" python3 "$check_creds" >/tmp/play-creds-out 2>/tmp/play-creds-err
  status=$?
  set -e
  printf '%s' "$status"
}

status="$(run_creds "")"
if [ "$status" -ne 0 ] || [ "$(cat /tmp/play-creds-out)" != "enabled=false" ]; then
  echo "FAIL blank secret should skip, status=$status out=$(cat /tmp/play-creds-out)"
  failures=$((failures + 1))
else
  echo "ok blank secret skips"
fi
status="$(run_creds $'  \n\t')"
if [ "$status" -ne 0 ] || [ "$(cat /tmp/play-creds-out)" != "enabled=false" ]; then
  echo "FAIL whitespace secret should skip, status=$status out=$(cat /tmp/play-creds-out)"
  failures=$((failures + 1))
else
  echo "ok whitespace secret skips"
fi
fake='{"type":"service_account","client_email":"play-upload@example.iam.gserviceaccount.com","private_key":"PRIVATE-KEY-MATERIAL"}'
status="$(run_creds "$fake")"
if [ "$status" -ne 0 ] || [ "$(cat /tmp/play-creds-out)" != "enabled=true" ]; then
  echo "FAIL valid service account should enable upload, status=$status"
  failures=$((failures + 1))
elif grep -q 'PRIVATE-KEY-MATERIAL' /tmp/play-creds-out /tmp/play-creds-err; then
  echo "FAIL credential check printed the private key"
  failures=$((failures + 1))
elif ! grep -q 'play-upload@example.iam.gserviceaccount.com' /tmp/play-creds-err; then
  echo "FAIL credential check did not log the service account email"
  failures=$((failures + 1))
else
  echo "ok valid service account enables upload without printing the key"
fi
status="$(run_creds '{"type":"service_account","private_key":"PRIVATE-KEY-MATERIAL"}')"
if [ "$status" -eq 0 ]; then
  echo "FAIL incomplete service account was accepted"
  failures=$((failures + 1))
elif grep -q 'PRIVATE-KEY-MATERIAL' /tmp/play-creds-out /tmp/play-creds-err; then
  echo "FAIL incomplete-key error printed the private key"
  failures=$((failures + 1))
else
  echo "ok incomplete service account is rejected"
fi
status="$(run_creds '{not-json PRIVATE-KEY-MATERIAL')"
if [ "$status" -eq 0 ]; then
  echo "FAIL invalid JSON was accepted"
  failures=$((failures + 1))
elif grep -q 'PRIVATE-KEY-MATERIAL' /tmp/play-creds-out /tmp/play-creds-err; then
  echo "FAIL invalid-JSON error printed the secret contents"
  failures=$((failures + 1))
else
  echo "ok invalid JSON is rejected without echoing it"
fi

if [ "$failures" -ne 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "play track guard ok"
