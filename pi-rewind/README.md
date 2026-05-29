# pi-rewind

> Rewind your session to a previous point and permanently delete the entries you skip over.

## Problem

Pi's built-in `/tree` lets you navigate back to any point in your session, but it **never deletes anything**. All the messages from the abandoned branch stay in the session file forever, consuming context tokens and cluttering your history.

## Solution

`/rewind` shows you a flat list of all user/assistant turns in your session (newest first). You pick a rewind target, confirm, and the extension:

1. Navigates the session tree to that point (like `/tree`)
2. **Permanently deletes** all entries after the target from the session JSONL file
3. Updates the in-memory session state

Your session file stays clean — skipped messages are truly gone.

## Install

This package lives in the [pi-packages](https://github.com/ssweens/pi-packages) monorepo. After installing Pi:

```bash
# From the monorepo
pi -e ./pi-rewind/index.ts
```

For permanent install, copy `pi-rewind/` to your extensions directory:

```bash
cp -r pi-rewind ~/.pi/agent/extensions/pi-rewind
```

Then `/reload` in Pi.

## Usage

```
/rewind
```

You'll see a selector showing all message turns in your session (newest first):

```
1.  14:32:15  assistant       Let me check the logs...
2.  14:32:10  user            Can you debug this error?
3.  14:31:55  assistant       I'll look into it...
4.  14:31:50  user            Something is broken
...
```

Pick a point to rewind to. You'll get a confirmation dialog showing how many entries will be permanently deleted.

After confirming, the session navigates to that point and the pruned entries vanish from disk.

## Differences from /tree

| Feature            | `/tree`           | `/rewind`              |
|--------------------|-------------------|------------------------|
| UI                 | Full tree browser | Flat filtered list     |
| Deletes entries    | No                | Yes                    |
| Branch summaries   | Optional          | No (summaries removed) |
| Undo               | Can navigate back | Destructive, no undo   |

## Safety

- Always confirms before deleting
- Only removes entries *after* the selected target timestamp
- Preserves the full ancestor chain (nothing upstream is lost)
- Targets user+assistant messages so you always pick a meaningful rewind point
