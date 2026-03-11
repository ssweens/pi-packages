# qq.sh - Keystrokes for pi-qq screenshot
# $WID is the iTerm window ID

# Give the initial "Hello!" response time to finish
sleep 3

# Type a long /qq question to trigger the scrollbar
osascript -e "tell application \"iTerm2\" to tell current session of window id ${WID} to write text \"/qq Can you explain the difference between a subagent and a side question in terms of tools, context reuse, and ephemerality? Give me a multi-line comparison.\" without newline"
sleep 1
osascript -e "tell application \"iTerm2\" to tell current session of window id ${WID} to write text (ASCII character 13)" # Enter

# Wait for stream to finish and viewport to hit max height
sleep 8
