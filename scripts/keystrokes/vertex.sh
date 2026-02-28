# Open model selector (Ctrl+L), filter to vertex models
osascript -e "tell application \"iTerm2\" to tell current session of window id ${WID} to write text (ASCII character 12)"
sleep 3
osascript -e "tell application \"iTerm2\" to tell current session of window id ${WID} to write text \"ver\" without newline"
sleep 2
