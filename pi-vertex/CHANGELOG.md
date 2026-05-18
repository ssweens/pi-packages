# Changelog

All notable changes to this project will be documented in this file.

## [1.1.6] - 2026-05-16
### Fixed
- **`maxTokens / 2` halving removed** — both the Anthropic and OpenAI-compat MaaS streaming paths were silently capping requests at half the model's stated `maxTokens`. Requests now use the full `maxTokens` value unless the caller explicitly overrides it.
- **Gemini cached token double-counting** — `promptTokenCount` includes cached tokens, so input cost was inflated. Input usage is now `promptTokenCount − cachedTokenCount`, matching the actual billable amount.
- **`sanitizeText` corrupted emoji** — the previous regex replaced all surrogate code units including valid pairs (emoji are encoded as two surrogates). Now only unpaired/lone surrogates are stripped.
- **Gemini Pro can't use `MINIMAL` thinking level** — `ThinkingLevel.MINIMAL` is only valid for Flash models. Pro requests with `minimal`/`low` effort now floor to `ThinkingLevel.LOW`.
- **Reasoning models always get a minimum thinking config** — previously thinking was only configured when an explicit `reasoning` effort was passed. For reasoning-capable Gemini models, a minimum config (lowest budget/level) is now always set, matching pi-mono behavior and preventing silent thought suppression.
- **`convertToGeminiMessages`: missing tool results injected** — if an assistant turn with tool calls has no matching `toolResult` message, a synthetic error result (`"No result provided"`) is flushed before the next turn. Prevents Gemini 400 errors from dangling tool calls.
- **`convertToGeminiMessages`: image tool results supported** — `toolResult` messages containing image content are now forwarded correctly. Gemini 3+ models receive them as `functionResponse.parts`; older models get a separate user image turn.
- **`convertToGeminiMessages`: tighter same-model guard** — thought signature replay now also requires `api === "google-generative-ai"` so signatures from non-Gemini providers (e.g. Claude) are never incorrectly forwarded.
- **`convertToGeminiMessages`: removed `id` from `functionCall` parts** — the `requiresToolCallId` heuristic was wrong; Gemini does not use tool call IDs in `functionCall` parts.

### Updated
- `claude-opus-4-6`: `maxTokens` corrected to `128000` (was `32000`)
- `claude-sonnet-4-6`: `maxTokens` corrected to `128000` (was `64000`)
- `convertToolsForGemini` / `convertTools`: signatures tightened from `any[]` to typed `Tool[]`

*Bug fixes co-discovered with [lhl/pi-vertex](https://github.com/lhl/pi-vertex), a respected community fork. Credit: @lhl.*

## [1.1.5] - 2026-05-16
### Added
- **xAI Grok models** (new publisher on Vertex MaaS OpenAI-compat endpoint):
  - `grok-4.20-reasoning` — flagship model, 200K context, text+image input, reasoning+tools, $1.25/$2.50 per 1M tokens
  - `grok-4.1-fast-reasoning` — cost-effective model, 128K context, text+image input, reasoning+tools, $0.20/$0.50 per 1M tokens
- **Claude Opus 4.7** (`claude-opus-4-7`) — 1M context, 128K max output tokens (up from 4.6's 32K), $5.00/$25.00 per 1M, same cache pricing as Opus 4.6
- **Gemma 4 26B A4B IT** (`gemma-4-26b-a4b-it`) — Google's MoE instruction-tuned model via MaaS, 262K context, 128K max output, text+image input, $0.15/$0.60 per 1M tokens

## [1.1.4] - 2026-03-30
### Fixed
- Removed error message override for `400 (no body)` responses from Vertex MaaS models. The original message now passes through to `isContextOverflow()` which already handles this pattern, enabling proper auto-compact instead of showing a raw error to the user.
- Use `zai` thinking format for `zai-org` publisher models (GLM-5). Previously using `openai` format which never sent `enable_thinking`, causing intermittent 400 errors from the ZAI API.

## [1.1.3] - 2026-03-26
### Fixed
- Hardened Claude-on-Vertex replay for mid-session model switching (tool ID normalization, tool result adjacency, thinking signature validation).
- Prevented Anthropic tool replay errors by inserting synthetic tool results when missing.

### Updated
- Claude 4.6 models use native Anthropic Vertex SDK streaming.
- Claude 4.6 context window updated to 1M.
- Model list order in the selector is now alphabetized by ID.

## [1.1.2] - 2026-03-24
### Changed
- Initial Claude 4.x support on Vertex.
