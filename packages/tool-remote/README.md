---
description: "Model-facing remote host tools over the discovery and transport seams: search providers, open persistent ssh sessions, and run one-shot remote commands for users delegating remote work to the agent."
kind: "package-reference"
---

# @cryptocurpays/dsh-tool-remote

English | [中文](README.zh.md)

## Summary

Model-facing remote host tools over the discovery and transport seams. This package owns the Consumer role for both `ctx.remoteHosts` and `ctx.terminals`: `remote_search` lists non-secret host metadata, `remote_open` publishes a persistent SSH session and records the remote hostname in the known-host dictionary, `remote_exec` runs one bounded command through a temporary session, `remote_close` closes one persistent session and forgets its host, and `remote_close_all` closes every owned ssh session and clears their hosts from the dictionary. Credentials never appear in tool arguments or results — the discovery spec carries a `CredentialRef` resolved by the backend.

No invariant companion is published because the tools only route to the discovery and terminal registries, which validate ownership and results at each call; no independent snapshot exists for a companion to check.

## Table of Contents

- [Tools](#tools)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="tools"></a>
## Tools

| Tool | Behavior |
|---|---|
| `remote_search(query)` | Lists matching non-secret specs (`name`, `host`, `port`, optional `username`); known hosts first. |
| `remote_open(hostRef, name?)` | Creates a persistent owner-isolated SSH connection from a pasted JumpServer connect command, a configured host name (file provider), or any `remote_search` result; learns the remote hostname via `hostname` (best-effort, 5s bound) and remembers the host with the session id. |
| `remote_exec(hostRef \| sessionId, command, timeoutMs?)` | One bounded command; `sessionId` (from `remote_open`) reuses the open connection with zero re-authentication, `hostRef` opens a temporary session closed afterwards. Returns the real `exitCode` (captured via a `__DSH_EXIT__` marker), `stdout`, `waitReason`, `truncated`. |
| `remote_close(sessionId)` | Kills the session and forgets its host from the known-host dictionary. |
| `remote_close_all()` | Closes every persistent ssh session owned by the calling agent and forgets their hosts; non-ssh sessions stay untouched. Returns `closed` and `hosts`. |

The consumer also registers one `tool:remote` system-prompt section guiding host discovery and session hygiene.

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the guidance below, which steers host discovery and session lifecycle.

##### Remote guidance

```markdown
Create a remote connection with remote_open, passing a pasted JumpServer connect command or a remote_search result as hostRef. Run commands on it with remote_exec (reuse its sessionId for zero re-authentication) or the terminal tools. Track and close every session id; remote_close_all closes them all at once.
```

#### Token effect

A small fixed input cost per request while the plugin is active, unchanged by which remote host is addressed.

#### KV Cache effect

Prefix-stable while the registration scope and prompt text are unchanged; plugin activation or disposal may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The model sees the five [`tool-remote` schemas](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md#deepseek-aidsh-tool-remote): `remote_search`, `remote_open`, `remote_exec`, `remote_close`, and `remote_close_all`, with exactly the fields above.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while visibility and the five definitions are unchanged; a config change or restriction may invalidate reuse from the first changed definition.

### Results

#### What the model sees

`remote_search` returns a JSON array of non-secret metadata. `remote_open` returns session facts (`sessionId`, `type`, `pid`, `status`, `motd`) for the generic terminal tools. `remote_exec` returns the settled viewport as `stdout` with the real `exitCode` (a `__DSH_EXIT__` marker wraps the command; the transport's exit status is the fallback when no marker survived), `waitReason`, and `truncated`; the viewport is bounded by the transport's `maxReadBytes` (default 256 KiB). `remote_close` returns `closed` plus the forgotten `host` when it was live. `remote_close_all` returns the count and host list it closed, or reports that no remote sessions were open.

#### Token effect

Zero result tokens before a call; a call's output is data-dependent and bounded by the transport read cap.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Results depend on the transport bound** — the model-visible output cap comes from the mounted backend's `maxReadBytes`; the tools themselves apply no independent cap.
- **No automatic cleanup of orphaned sessions** — if a persistent session dies outside `remote_close`, its known-host row stays until a consumer forgets it or the process restarts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tools are thin consumers over the discovery and terminal registries; session ownership and result validation stay in those seams.

</details>
