#!/bin/bash
# Сверяет разбор расписания на Mac (Swift) с веб-версией: tests/schedule-cases.json → tests/schedule-swift.json
set -euo pipefail
cd "$(dirname "$0")/.."
KOMET=${KOMET:-$HOME/Documents/Komet}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
swiftc -target "$(uname -m)-apple-macos13.0" -lsqlite3 \
  $(find "$KOMET/Sources/Shared" "$KOMET/Sources/Mac" -name '*.swift' ! -name LYOApp.swift) \
  scripts/schedule-parity/main.swift -o "$TMP/run" 2>&1 | grep -E "error" || true
TZ=Europe/Moscow "$TMP/run" tests/schedule-cases.json > tests/schedule-swift.json
echo "Готово: tests/schedule-swift.json"
