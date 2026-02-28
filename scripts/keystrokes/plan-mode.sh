# Toggle plan mode with Alt+P via System Events keystroke
osascript << APPLESCRIPT
tell application "iTerm2" to activate
delay 0.5
tell application "System Events"
    keystroke "p" using option down
end tell
APPLESCRIPT
sleep 3
