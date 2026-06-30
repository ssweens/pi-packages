# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
### Fixed
- Added configurable model-source support so providers can fetch models from arbitrary catalog endpoints with JSON paths for item arrays and model ids/names.
- Added ClinePass support via `https://api.cline.bot/api/v1/ai/cline/recommended-models` and `clinePass` item-path mapping.
- Resolved provider `apiKey` values inside `pi-dynamic-models` before startup fetches and provider registration, so raw env var names and `$ENV_VAR` / `${ENV_VAR}` references now work as intended.
- Stopped sending auth headers for the open-server placeholder value `none`.

## [1.0.1] - 2026-05-30
### Fixed
- Corral metadata lookup now supports servers configured with `/v1` base URLs by trying `/corral/models` from the server root as well as `${baseUrl}/corral/models`.
- Prevented sending `Authorization: Bearer none` when `apiKey` is set to the open-server placeholder value `"none"`.

### Impact
- `contextWindow` now correctly picks up live `context_size` from corral servers when available, instead of silently falling back to `128000` due to a metadata endpoint path mismatch.
