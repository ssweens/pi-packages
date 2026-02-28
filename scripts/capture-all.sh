#!/bin/bash
# capture-all.sh — Capture screenshots for all packages that have keystroke files
#
# Usage:
#   ./scripts/capture-all.sh
#   ./scripts/capture-all.sh pi-vertex   # single package

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

capture_one() {
    local pkg="$1"
    local keyfile="${SCRIPT_DIR}/keystrokes/${pkg#pi-}.sh"
    if [ ! -f "$keyfile" ]; then
        echo "Skipping ${pkg}: no keystroke file at ${keyfile}"
        return
    fi
    "${SCRIPT_DIR}/capture-screenshot.sh" "$pkg" "$keyfile"
    echo ""
}

if [ $# -gt 0 ]; then
    capture_one "$1"
else
    for keyfile in "${SCRIPT_DIR}"/keystrokes/*.sh; do
        pkg="pi-$(basename "$keyfile" .sh)"
        capture_one "$pkg"
    done
fi
