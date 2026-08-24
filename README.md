# @max-null/dsh-guardian

本插件属于 **`@max-null/*` 插件系列**——这一系列共同构成 **[SSID（思灵 · Seek Soul in Darkness）](https://github.com/Max-Null/seek-soul-in-darkness)** 桌面体验。SSID 是整合它们的盒：`dsh-capture` · `dsh-chat-rail` · `dsh-chinese-thinking` · `dsh-draft-polish` · `dsh-guardian` · `dsh-habit` · `dsh-header-unify` · `dsh-memory` · `dsh-node-appearance` · `dsh-plugin-center` · `dsh-skill-mcp-center` · `dsh-ssid-panels` · `dsh-ssid-zh-ui`。

This plugin belongs to the **`@max-null/*` family** — a set of plugins that together form the **[SSID (思灵 · Seek Soul in Darkness)](https://github.com/Max-Null/seek-soul-in-darkness)** desktop experience.

Guardian state engine for the DeepSeek Harness — three trigger-line monitors
over session events, with live reminder injection and a UI snapshot service.

M2 of SSiD (思灵), ported from fractal's guardian: assertion counting, the
edit review queue, and no-feedback-loop monitoring.

## What it monitors

| Trigger line | Rule |
|---|---|
| Assertion count | Scans assistant messages for unverified claims (`不支持/做不到/只有 N 种/不存在/无法 X/远低于/过于 X`). Counts per session, decays by 1 every 3 clean turns, segments into levels [1,3]+. |
| Edit review queue | Successful `write`/`edit` tool calls enqueue `{filePath, sessionId, turn}`. FIFO cap 20, dedup per file+session. Reminder lists them at turn end. |
| No-feedback loop | Per turn: edits without `bash`/`pwsh` increment the counter; any exec resets it. 3 consecutive edit-only turns inject a "build a feedback loop first" warning. |

## Compose

```yaml
# cordis.yml (or via the bundle patch):
- id: guardian
  name: '@max-null/dsh-guardian'
```

Requires `storage`, `system-prompt` in the host composition (dsh-base ships
both). Installs as a bundle: `dsh plugin --profile <name> add @max-null/dsh-guardian`.

## Services

- `ctx.guardian` — the engine:
  - `snapshot()` → `{ session, reviewQueue }` for UI panels
  - `sessionState(sessionId)` → per-session state
- Three dynamic `systemPrompt.context` reminders (`guardian:assertion`,
  `guardian:no-feedback`, `guardian:review`), evaluated per assembly from the
  most recently active session.

## Config

| Field | Default | Meaning |
|---|---|---|
| `decayTurns` | `3` | Clean turns before one assertion point decays |
| `assertionThresholds` | `[1, 3]` | Ascending thresholds segmenting levels 1-3 |
| `noFeedbackThreshold` | `3` | Consecutive edit-only turns before the warning |
| `reviewQueueMax` | `20` | Review queue FIFO cap |
| `globalRoot` | `$DSH_HOME/storages/guardian` | JSON storage root |

## Storage

One JSON unit (`guardian`, version 1) under `$DSH_HOME/storages/guardian`:
`sessions` table (per-session state) + the global slot (review queue).
In-memory is authoritative during a run; state flushes at turn end.

## Develop

```sh
npm install --legacy-peer-deps   # DSH peer types resolve via tsconfig paths
npm test                         # vitest: 27 pure-function tests
npm run typecheck                # tsc against adjacent deepseek-harness lib/types
npm run build                    # emit dist/
```

> The npm registry carries unsynchronized DSH rc versions, so dev tooling
> resolves `@deepseek-ai/*` types through `tsconfig.json` paths pointing at an
> adjacent `deepseek-harness` checkout (`../deepseek-harness`). Runtime peer
> resolution is unaffected — the host composition supplies the real packages.

## SSID 系列


