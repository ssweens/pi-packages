# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-30
### Fixed
- Updated to `getApiKeyAndHeaders()` API (pi-coding-agent 0.64.0 compatibility — `getApiKey` was removed).
- Vertex and google-vertex providers no longer have their project ID forwarded as an API key to `compact()`, which was causing 401 UNAUTHENTICATED errors from the Vertex API.

### Added
- Retry logic with exponential backoff for transient HTTP errors (503, 502, 504, 429) during compaction.
- Session context block (session file path + thread ID) prepended to every compaction summary, enabling the agent to use `session_query` to retrieve older context.
- LLM-ranked `<important-files>` section in compaction summaries — top 3-5 files most relevant to the current goal, identified in a single LLM call.

## [1.0.0] - 2026-03-01
### Added
- Initial release.
