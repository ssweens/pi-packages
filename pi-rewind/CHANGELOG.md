# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-05-28
### Added
- `/rewind` command: flat selector showing all user/assistant turns (newest first)
- Picks a rewind target, navigates the session tree, then permanently deletes all entries after the target from the JSONL file
- Confirmation dialog showing count of entries to be deleted
