# Changelog

All notable changes to this project will be documented in this file.

## [1.1.9] - 2026-05-19
### Fixed
- **Gemini 3/3.5 default thinking preserved** — previously, if no reasoning effort level was specified, we silently overrode Gemini 3/3.5 models to use their lowest thinking level (`MINIMAL`). This severely degraded the intelligence of Gemini 3.5 Flash (defaulting it to no real reasoning/thinking) and Gemini 3 Pro/Flash. We now completely omit `thinkingConfig` when `options.reasoning` is undefined, allowing Gemini 3/3.5 models to use their native GA defaults (`MEDIUM` for 3.5 Flash, `HIGH` for others).
- **Gemini 2.5 default thinking budget** — Gemini 2.5 has thinking disabled by default on Vertex, so we now apply a healthy thinking budget floor (`2048` tokens for Pro, `1024` for Flash) when `options.reasoning` is undefined.

## [1.1.8] - 2026-05-19
### Added
- **Gemini 3.5 Flash** (`gemini-3.5-flash`) — GA release from Google I/O 2026. Most intelligent Flash model; optimized for agentic execution, coding, and long-horizon tasks. 1M context, 65K max output, text/image/video/audio input, reasoning (thinking levels: minimal/low/medium/high), tools. $1.50/$9.00 per 1M tokens (global), $0.15/1M cache read.

## [1.1.7] - 2026-05-16
### Added
- **Regional pricing for Claude models** — non-global Vertex endpoints (us-east5, europe-west1, asia-southeast1, us/eu multi-region) carry a 10% price premium per GCP's published rates. The streaming layer now automatically selects the correct cost tier based on the resolved endpoint at call time. No config change required — if your `GOOGLE_CLOUD_LOCATION` or config resolves to any non-`global` location, cost tracking reflects the regional rate.
  - Claude Opus 4.7/4.6/4.5: global $5.00/$25.00 → regional $5.50/$27.50
  - Claude Sonnet 4.6/4.5: global $3.00/$15.00 → regional $3.30/$16.50
  - Claude Haiku 4.5: global $1.00/$5.00 → regional $1.10/$5.50
  - Claude Opus 4.1, Opus 4, Sonnet 4: uniform pricing (no regional variant on GCP)
- **`costRegional?: ModelCost` field on `VertexModelConfig`** — optional cost tier used when the resolved GCP location is non-global. Models without this field use `cost` for all regions.

### Fixed
- **Grok cache read pricing** — previously 0 for both xAI models; corrected to GCP official rates:
  - `grok-4.20-reasoning`: cacheRead $0.20/1M
  - `grok-4.1-fast-reasoning`: cacheRead $0.05/1M

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
