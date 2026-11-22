#!/usr/bin/env python3
"""Write the fixed Play release notes used for every testing track."""

from __future__ import annotations

import os
import pathlib
import sys

RELEASE_NOTES = "We squashed bugs and improved performance so Patrol Radar is better for you"


def main() -> None:
    out_dir = pathlib.Path(os.environ.get("PLAY_DIR", "play"))
    notes_dir = out_dir / "whatsnew"
    notes_dir.mkdir(parents=True, exist_ok=True)
    (notes_dir / "whatsnew-en-US").write_text(RELEASE_NOTES + "\n", encoding="utf-8")
    print(f"Release notes: {RELEASE_NOTES}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"::error title=Release notes::{exc}", file=sys.stderr)
        sys.exit(1)
