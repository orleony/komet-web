#!/bin/bash
# Пересобирает tests/swift-parity.json из Mac-версии Komet (по московскому времени, как в тестах)
set -euo pipefail
cd "$(dirname "$0")/.."
KOMET=${KOMET:-$HOME/Documents/Komet}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
swiftc -target "$(uname -m)-apple-macos13.0" -lsqlite3 \
  $(find "$KOMET/Sources/Shared" "$KOMET/Sources/Mac" -name '*.swift' ! -name LYOApp.swift) \
  scripts/swift-parity/main.swift -o "$TMP/run"
TZ=Europe/Moscow "$TMP/run" tests/phrases.json | grep -v "Iteration\|Tokeniz\|Starting\|Finished" > tests/swift-parity.json
echo "Готово: $(grep -c '"phrase"' tests/swift-parity.json) фраз"
