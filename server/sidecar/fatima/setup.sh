#!/bin/sh
# Fetches the FAtiMA Toolkit (Apache-2.0, GAIPS-INESC-ID/FAtiMA-Toolkit) at the commit the sidecar was measured against.
# It is not vendored in this repo: the sidecar's csproj ProjectReferences it from $FATIMA_TOOLKIT_DIR (default ~/.risu-lan/fatima-toolkit).
#   sh server/sidecar/fatima/setup.sh
set -eu
PIN=56b7cbd992f953cfe21a7b12cb1a0e6cdf6ccf9f
URL=${FATIMA_TOOLKIT_URL:-https://github.com/GAIPS-INESC-ID/FAtiMA-Toolkit.git}
DIR=${FATIMA_TOOLKIT_DIR:-$HOME/.risu-lan/fatima-toolkit}

if [ -d "$DIR/.git" ] && [ "$(git -C "$DIR" rev-parse HEAD 2>/dev/null)" = "$PIN" ]; then
  echo "fatima toolkit already at $PIN in $DIR"
  exit 0
fi
if [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
  echo "$DIR exists and is not the pinned checkout; move it away or set FATIMA_TOOLKIT_DIR" >&2
  exit 1
fi
mkdir -p "$DIR"
git -C "$DIR" init -q
git -C "$DIR" remote add origin "$URL"
git -C "$DIR" fetch -q --depth 1 origin "$PIN"
git -C "$DIR" checkout -q FETCH_HEAD
echo "fatima toolkit $(git -C "$DIR" rev-parse --short HEAD) in $DIR"
