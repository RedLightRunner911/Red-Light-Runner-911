#!/usr/bin/env bash
# Upload one AAB with the pinned r0adkll/upload-google-play action.
# The action passes changesNotSentForReview straight through to edits.commit
# and fails the process when Play rejects that flag. This wrapper retries the
# upload without the flag only for that specific error.
#
# Required env: PLAY_JSON, TRACK, ACTION_DIR
# Optional env: DEBUG_SYMBOLS, GITHUB_OUTPUT, RUNNER_TEMP
set -euo pipefail

# "true" when alpha/beta should be held for Send for review. Internal is "false".
defer_review_for_track() {
  case "$1" in
    internal) printf 'false\n' ;;
    alpha|beta) printf 'true\n' ;;
    *) return 1 ;;
  esac
}

# Play: "Changes are sent for review automatically. The query parameter
# changesNotSentForReview must not be set."
# The opposite error ("Please set the query parameter changesNotSentForReview
# to true") must not match: retrying that one would send alpha/beta for review.
review_flag_rejected() {
  local log="$1"
  grep -q "changesNotSentForReview must not be set" "$log"
}

run_action() {
  local defer="$1"
  local log="$2"
  export INPUT_SERVICEACCOUNTJSONPLAINTEXT="$PLAY_JSON"
  export INPUT_PACKAGENAME="io.github.missionaryj.patrolradar"
  export INPUT_RELEASEFILES="play/patrol-radar-release.aab"
  export INPUT_TRACKS="$TRACK"
  export INPUT_STATUS="completed"
  export INPUT_CHANGESNOTSENTFORREVIEW="$defer"
  export INPUT_WHATSNEWDIRECTORY="play/whatsnew"
  export INPUT_MAPPINGFILE="play/mapping.txt"
  unset INPUT_TRACK INPUT_RELEASENAME INPUT_USERFRACTION INPUT_RELEASEFILE
  if [ -n "${DEBUG_SYMBOLS:-}" ]; then
    export INPUT_DEBUGSYMBOLS="$DEBUG_SYMBOLS"
  else
    unset INPUT_DEBUGSYMBOLS
  fi
  local status
  set +e
  node "$ACTION_DIR/lib/index.js" >"$log" 2>&1
  status=$?
  set -e
  cat "$log"
  return "$status"
}

main() {
  local track defer log status retried
  track="$(printf '%s' "${TRACK:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "$track" in
    internal|alpha|beta) ;;
    production|prod)
      echo "::error title=Production blocked::Refusing Play track '${track}'. This workflow cannot target production. Allowed tracks: internal, alpha, beta." >&2
      exit 1
      ;;
    *)
      echo "::error title=Production blocked::Refusing Play track '${track:-empty}'. Allowed tracks: internal, alpha, beta. Production is rejected. The upload action defaults to production when tracks is empty." >&2
      exit 1
      ;;
  esac
  TRACK="$track"
  defer="$(defer_review_for_track "$TRACK")"
  if [ ! -s play/patrol-radar-release.aab ] || [ ! -s play/mapping.txt ] || [ ! -s play/whatsnew/whatsnew-en-US ]; then
    echo "::error title=Play upload::Signed AAB, mapping.txt, or release notes are missing." >&2
    exit 1
  fi
  if [ ! -f "$ACTION_DIR/lib/index.js" ]; then
    echo "::error title=Play upload::Pinned upload-google-play action was not checked out at ${ACTION_DIR}." >&2
    exit 1
  fi

  log="${RUNNER_TEMP:-/tmp}/play-upload.log"
  echo "Uploading to ${TRACK} with changesNotSentForReview=${defer}."
  set +e
  run_action "$defer" "$log"
  status=$?
  set -e
  retried=false
  if [ "$status" -ne 0 ] && [ "$defer" = "true" ] && review_flag_rejected "$log"; then
    echo "::notice title=Play review flag::Play rejected changesNotSentForReview because this edit does not need review. Retrying the upload without that hold."
    retried=true
    defer=false
    set +e
    run_action "false" "$log"
    status=$?
    set -e
  fi
  if [ "$status" -ne 0 ]; then
    if grep -q "Please set the query parameter changesNotSentForReview to true" "$log"; then
      echo "::error title=Play review flag::Play refused to commit this edit unless changesNotSentForReview is set. The edit was not committed." >&2
    fi
    exit "$status"
  fi
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      printf 'review_hold=%s\n' "$defer"
      printf 'retried=%s\n' "$retried"
    } >>"$GITHUB_OUTPUT"
  fi
  echo "Play upload committed. track=${TRACK} changesNotSentForReview=${defer} retried=${retried}"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main
fi
