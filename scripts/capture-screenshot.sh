#!/bin/bash
# capture-screenshot.sh — Capture native iTerm screenshots of pi TUI states
#
# Usage:
#   ./scripts/capture-screenshot.sh <package-name> <keystroke-file>
#
# Example:
#   ./scripts/capture-screenshot.sh pi-vertex scripts/keystrokes/vertex.sh
#
# The keystroke file receives $WID (iTerm window ID) and should send
# whatever keystrokes are needed to get the TUI into the desired state.
#
# Requirements: iTerm2, pi, Google Cloud credentials (for vertex models)
#
# Environment (set these or edit defaults below):
#   GOOGLE_APPLICATION_CREDENTIALS
#   GOOGLE_CLOUD_PROJECT
#   GOOGLE_CLOUD_LOCATION

set -euo pipefail

PACKAGE="$1"
KEYSTROKE_FILE="$2"
OUTPUT="$(cd "$(dirname "$0")/.." && pwd)/${PACKAGE}/screenshot.png"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Defaults — override with env vars
: "${GOOGLE_APPLICATION_CREDENTIALS:=/Users/ssweens/cici_develop-applications-75118-87750ec20000.json}"
: "${GOOGLE_CLOUD_PROJECT:=develop-applications-75118}"
: "${GOOGLE_CLOUD_LOCATION:=global}"
: "${PI_LOAD_WAIT:=18}"
: "${HELLO_WAIT:=12}"

echo "=== Capturing screenshot for ${PACKAGE} ==="
echo "Output: ${OUTPUT}"

# 1. Create iTerm window and launch pi
WID=$(osascript << APPLESCRIPT
tell application "iTerm2"
    set newWindow to (create window with default profile)
    tell newWindow to set bounds to {50, 50, 1350, 950}
    tell current session of newWindow
        write text "export GOOGLE_APPLICATION_CREDENTIALS=${GOOGLE_APPLICATION_CREDENTIALS}"
        write text "export GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT}"
        write text "export GOOGLE_CLOUD_LOCATION=${GOOGLE_CLOUD_LOCATION}"
        write text "clear && pi --no-session --model k2p5"
    end tell
    return id of newWindow
end tell
APPLESCRIPT
)
export WID
echo "Window ID: ${WID}"

# 2. Wait for pi to load
echo "Waiting ${PI_LOAD_WAIT}s for pi to load..."
sleep "${PI_LOAD_WAIT}"

# 3. Send Hello! for conversation context
osascript -e "tell application \"iTerm2\" to tell current session of window id ${WID} to write text \"Hello!\""
echo "Waiting ${HELLO_WAIT}s for response..."
sleep "${HELLO_WAIT}"

# 4. Run the keystroke script
echo "Running keystrokes: ${KEYSTROKE_FILE}"
source "${KEYSTROKE_FILE}"

# 5. Capture the window
screencapture -l "${WID}" "${OUTPUT}"
echo "Saved: ${OUTPUT} ($(du -h "${OUTPUT}" | awk '{print $1}'))"

# 6. Close the window
osascript -e "tell application \"iTerm2\" to close window id ${WID}" 2>/dev/null || true

echo "Done."
