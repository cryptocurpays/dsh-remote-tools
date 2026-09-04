# GitHub Discussion draft: terminal per-spawn parameters

Draft for posting at https://github.com/deepseek-ai/deepseek-harness/discussions
(upstream does not accept external PRs while pre-release, but welcomes suggestions
and votes in Discussions). Project-specific details are intentionally genericized.

---

## Title

`Suggestion: let terminal backends receive per-spawn parameters — unblocks out-of-tree SSH backends and persistent remote sessions`

## Short version

`TerminalSpawnRequest` carries only `type` / `name` / `cwd`. A backend outside the
official tree (e.g. an SSH backend) needs a generic way to receive per-spawn data
— "which host should this session connect to?" — and currently has no clean
channel for it. I propose a small, backward-compatible, backend-agnostic `params`
field.

## Background

`ctx.terminals` is the shared entry point for persistent PTY sessions. Community
backends — which the project explicitly encourages via the ecosystem-plugin path —
currently have no way to pass backend-specific arguments through
`ctx.terminals.spawn`. An SSH backend can only smuggle the target through `cwd` or
a process-local side-channel registry, both fragile (colliding under concurrent
spawns) and semantically wrong.

## Proposed change (6 lines, additive, not SSH-specific)

```diff
--- a/packages/terminal/terminal/src/types.ts
+++ b/packages/terminal/terminal/src/types.ts
@@ interface TerminalSpawnRequest {
   name?: string
   /** Optional initial working directory interpreted by the backend. */
   cwd?: string
+  /**
+   * Optional backend-owned parameters. Generic consumers and backends ignore
+   * this; a backend that understands a key (e.g. `target`) reads it.
+   */
+  params?: Record<string, string>
 }
```

```diff
--- a/packages/terminal/terminal/src/index.ts
+++ b/packages/terminal/terminal/src/index.ts
@@ TerminalSessionService.spawn:
         type: request.type,
         ...request.name !== undefined ? { name: request.name } : {},
         ...request.cwd !== undefined ? { cwd: request.cwd } : {},
+        ...request.params !== undefined ? { params: request.params } : {},
         signal: backendSignal,
```

- Optional: existing consumers and backends are unaffected.
- Generic: nothing here is SSH-specific — any future backend needing per-spawn
  arguments (e.g. a container-exec or remote-shell backend) can use the same
  channel.

## Why this matters in practice

I run a fleet of remote application servers (several machines, each hosting
multiple long-lived services) and regularly do cross-host operations — checking
logs, comparing service health, chasing issues across hosts. With an out-of-tree
bundle I maintain ([`dsh-remote-tools`](https://github.com/cryptocurpays/dsh-remote-tools),
tagged `dsh-plugin`), the workflow is:

`remote_search` (discover hosts) → `remote_open` (open a **persistent SSH
session**) → repeated `remote_exec(sessionId)` (reuse the session, **zero
re-authentication**) → `remote_close`.

Compared to spawning a fresh `ssh` per command (each with its own TCP handshake +
auth round trip), keeping the session alive is noticeably faster for both "many
commands against one host" and "the same check across many hosts", and it
preserves shell state (cwd, environment) across steps — which matters for
multi-step investigation flows.

The 6-line `params` channel is the enabler: without it, the SSH backend cannot
learn which host a given spawn should target, so this whole pattern is blocked at
the seam.

## Current state / ask

Since the repository does not currently accept external pull requests, I carry
these 6 lines as a local patch alongside the plugin (documented in the plugin
repo). If the direction seems reasonable, I'd welcome the team considering it —
implemented internally, or merged once external contributions open — so community
terminal backends (my SSH backend being the first) don't each have to maintain
their own patch.

Happy to provide any further detail (exact diff, plugin usage, more scenarios)
here.

---

## 本地配套说明（不在正文中）

- 对应本地补丁：`patches/terminal-params.patch`（应用说明见 `docs/terminal-params-patch.md`）
- 本地挂载流程：见 `docs/local-mount.md`
- 如需调整措辞或删去插件链接，改本文件后重新发布即可
