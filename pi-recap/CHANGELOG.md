# Changelog

## 1.0.0 (2026-06-27)

- Initial release
- Idle timer-based away detection (triggers after agent_end, cancelled on input)
- Side LLM call generates ≤40 word recap using conversation context
- Ephemeral widget display (never written to transcript)
- Gating: ≥3 user turns, ≥2 messages since last recap, no draft text
- Configurable threshold via `/recap <N>m|s`
- On/off toggle via `/recap on|off`
- Recap count persisted across session reloads
- Disable hint on first 3 recaps
