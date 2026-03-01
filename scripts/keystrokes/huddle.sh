# Step 1: Toggle huddle mode with Alt+H
osascript << APPLESCRIPT
tell application "iTerm2" to activate
delay 0.5
tell application "System Events"
    keystroke "h" using option down
end tell
APPLESCRIPT
sleep 3

# Step 2: Ask the agent to call ask_user so we can capture the dialog
# (ask_user blocks until the user responds — perfect for a screenshot)
ASK_USER_OUTPUT="${OUTPUT/screenshot.png/ask-user-screenshot.png}"

osascript << APPLESCRIPT
tell application "iTerm2"
    tell current session of window id ${WID}
        write text "Use the ask_user tool right now to ask me 2 questions: (1) Which auth method should we use? with options: JWT tokens, Session cookies, OAuth2 / OIDC, API keys — and (2) Which features do you want? (multiSelect) with options: Logging, Metrics, Tracing, Alerts"
    end tell
end tell
APPLESCRIPT

# Wait for the agent to think and invoke ask_user (dialog will block)
echo "Waiting 30s for ask_user dialog to appear..."
sleep 30

# Step 3: Capture the ask_user dialog while it's open
echo "Capturing ask_user dialog -> ${ASK_USER_OUTPUT}"
screencapture -l "${WID}" "${ASK_USER_OUTPUT}"

# Step 4: Dismiss the dialog so the main script can capture screenshot.png cleanly
osascript << APPLESCRIPT
tell application "System Events"
    key code 53
end tell
APPLESCRIPT
sleep 3

# Main script now captures screenshot.png = huddle mode status bar
