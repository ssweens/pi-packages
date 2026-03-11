# qq.sh - Keystrokes for pi-qq screenshot
# $WID is the iTerm window ID

# Give the initial "Hello!" response time to finish
sleep 2

# Type /qq question
osascript -e "tell application \"iTerm2\" to tell current session of window id ${WID} to write text \"/qq What is the purpose of this project?\""
sleep 5
