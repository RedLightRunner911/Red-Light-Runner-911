#!/usr/bin/env bash
# Resolve the Google Play track for a Patrol Radar workflow run.
# Usage: resolve-play-track.sh EVENT_NAME TRACK_INPUT REPOSITORY REF
# Prints "internal", "alpha", or "beta". Exits 1 for every refusal, including production.
# A push to main always resolves to internal. The track input cannot retarget a push.
set -euo pipefail

event_name="${1:-}"
track_input="${2:-}"
repository="${3:-}"
ref="${4:-}"

die() {
  echo "::error title=Play upload blocked::$1" >&2
  exit 1
}

if [ "$event_name" = "pull_request" ]; then
  die "Refusing to upload to Google Play from a pull_request run."
fi

if [ "$repository" != "missionaryj/patrol-radar" ]; then
  die "Refusing to upload from repository '${repository:-unknown}'. Only missionaryj/patrol-radar may upload."
fi

if [ "$ref" != "refs/heads/main" ]; then
  die "Refusing to upload from '${ref:-unknown}'. Play uploads run only from refs/heads/main."
fi

case "$event_name" in
  push)
    # Main merges go to internal testing only. A push payload cannot select alpha, beta, or production.
    track="internal"
    ;;
  workflow_dispatch)
    track="$track_input"
    ;;
  *)
    die "Event '${event_name:-unknown}' cannot upload to Google Play."
    ;;
esac

# Case-fold and drop whitespace so "Production" and " beta " cannot sneak through.
track="$(printf '%s' "$track" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

case "$track" in
  internal|alpha|beta) ;;
  production|prod)
    die "Refusing Play track '${track}'. This workflow cannot target production. Allowed tracks: internal, alpha, beta."
    ;;
  "")
    die "No Play track was set. The upload action defaults to production when tracks is empty, so this workflow refuses to continue."
    ;;
  *)
    die "Play track '${track}' is not allowed. Allowed tracks: internal, alpha, beta. Production is rejected."
    ;;
esac

printf '%s\n' "$track"
