# Type /handoff to show the slash command
osascript -e "tell application \"iTerm2\" to tell current session of window id ${WID} to write text \"/handoff\" without newline"
sleep 2
