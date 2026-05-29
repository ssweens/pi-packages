# Suggested Next Features

1. **Account Profiles / Workspaces**
   - Save groups of account + provider + model settings as named profiles.
   - Example: `work`, `personal`, `openrouter-testing`, `cheap-models`.

2. **Quick Switch Command**
   - Add one command to switch account, provider, and model together.
   - Example: `Account Switcher: Quick Switch Profile`.

3. **Auto-switch by Project**
   - Remember preferred account/model per project directory.
   - When Pi starts in a repo, automatically activate the configured account.

4. **Credential Health Check**
   - Add command to verify whether active account credentials are valid.
   - Could test env vars, file secrets, command secrets, and provider API key presence.

5. **Import from Existing Environment**
   - Detect common env vars like `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`.
   - Offer to create accounts from current shell environment.

6. **Account Usage Metadata**
   - Track last-used time, usage count, and recently active accounts.
   - Improve picker sorting: recent accounts first.

7. **Mask / Reveal Secrets Command**
   - Add a safe command to inspect account config with secrets masked.
   - Optional reveal flow with confirmation.

8. **Backup / Export / Import**
   - Export accounts/providers/state to a portable encrypted or redacted JSON file.
   - Useful for moving setup between machines.

9. **Provider Templates**
   - Built-in templates for Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, local providers.
   - Makes custom provider setup easier.

10. **Status Bar / Session Banner**
    - Show currently active account/provider/model at session start.
    - Helps avoid accidentally using the wrong API key.

## Recommended First Feature

**Auto-switch by Project** is the best next feature to implement first because it is highly useful, low-risk, and fits naturally with the existing state/storage architecture.
