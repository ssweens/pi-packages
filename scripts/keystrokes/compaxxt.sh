# compaxxt.sh - Keystrokes for pi-compaxxt screenshot
# $WID is the iTerm window ID

# Run compaction
osascript -e "tell application \"iTerm2\" to tell current session of window id ${WID} to write text \"/compact\""
sleep 10
