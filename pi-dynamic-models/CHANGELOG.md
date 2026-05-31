# Changelog

All notable changes to this project will be documented in this file.

## [1.0.1] - 2026-05-30
### Fixed
- Corral metadata lookup now supports servers configured with `/v1` base URLs by trying `/corral/models` from the server root as well as `${baseUrl}/corral/models`.
- Prevented sending `Authorization: Bearer none` when `apiKey` is set to the open-server placeholder value `"none"`.

### Impact
- `contextWindow` now correctly picks up live `context_size` from corral servers when available, instead of silently falling back to `128000` due to a metadata endpoint path mismatch.
