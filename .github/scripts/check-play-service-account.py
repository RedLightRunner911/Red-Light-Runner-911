#!/usr/bin/env python3
"""Report whether PLAY_SERVICE_ACCOUNT_JSON can upload to Google Play.

Stdout is a single token: enabled=true or enabled=false.
A blank value is enabled=false (the workflow skips the upload).
A non-blank value that is not a service-account key exits 1.
The private key is never printed.
"""

from __future__ import annotations

import json
import os
import sys


def main() -> None:
    raw = os.environ.get("PLAY_JSON", "")
    if not raw.strip():
        print("enabled=false")
        return
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        print(
            "::error title=Play credentials::PLAY_SERVICE_ACCOUNT_JSON is set but is not valid JSON.",
            file=sys.stderr,
        )
        sys.exit(1)
    email = str(data.get("client_email", "")).replace("\n", " ").strip() if isinstance(data, dict) else ""
    private_key = str(data.get("private_key", "")).strip() if isinstance(data, dict) else ""
    if not isinstance(data, dict) or data.get("type") != "service_account" or not email or not private_key:
        print(
            "::error title=Play credentials::PLAY_SERVICE_ACCOUNT_JSON must be a Google service-account key with type, client_email, and private_key.",
            file=sys.stderr,
        )
        sys.exit(1)
    print("enabled=true")
    print(f"Play service account: {email}", file=sys.stderr)


if __name__ == "__main__":
    main()
