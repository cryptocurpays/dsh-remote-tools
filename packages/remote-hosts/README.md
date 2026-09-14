---
description: "Remote-host discovery seam (ctx.remoteHosts): provider registry, host-reference resolution, known-host dictionary, and live-session map for users and maintainers choosing or extending remote connections."
kind: "package-reference"
---

# @zealousw/dsh-remote-hosts

English | [中文](README.zh.md)

## Summary

The **`RemoteHostDirectory`** (`ctx.remoteHosts`) defines how the harness finds remote hosts worth connecting to — JumpServer assets, pass-store `ssh` entries, or anything else a provider advertises — without binding the model contract to one inventory's format.

No invariant companion is published because the directory validates provider ids and uniqueness at each registration and publishes no independent snapshot a companion could cross-check.

This package owns the Service Definition role of the remote-host discovery capability:

| Package | Role |
|---|---|
| `@zealousw/dsh-remote-hosts` (this) | Service Definition: provider registry, resolution, known-host dictionary, live-session map |
| `@zealousw/dsh-remote-hosts-jumpserver` | Provider: parses pasted JumpServer SSH connect commands |
| `@zealousw/dsh-remote-hosts-file` | Provider: static test servers from `~/.dsh/remote-hosts.yaml` |
| `@zealousw/dsh-terminal-ssh` | Transport: SSH PTY backend for `ctx.terminals` |
| `@zealousw/dsh-tool-remote` | Consumer: the model-facing `remote_search` / `remote_open` / `remote_exec` / `remote_close` tools |

A `RemoteHostSpec` carries only non-secret connection facts (`name`, `host`, `port`, optional `username`) plus a `CredentialRef`; the credential value never enters the directory.

## Table of Contents

- [Service API (`ctx.remoteHosts`)](#service-api-ctxremotehosts)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="service-api-ctxremotehosts"></a>
## Service API (`ctx.remoteHosts`)

| Member | Semantics |
|---|---|
| `registerProvider(provider)` / `listProviders()` | Register a provider; returns a disposer that removes exactly that contribution (effect-bound, HMR-safe). Throws `RemoteHostError` `DUPLICATE_PROVIDER` on a duplicate id. |
| `resolve(ref)` | Run the first matching provider. Throws `RemoteHostError` `NO_PROVIDER` when none matches, or the matching provider's own rejection. |
| `search(query)` | Merged non-secret specs: known hosts first, deduplicated by name, then providers in registration order. |
| `remember(spec, sessionId?)` | Record a successfully connected host; a later record for the same host replaces the earlier one (last connection wins). |
| `forget(host)` / `forgetAll()` | Remove one or every known host, dropping its live-session association. |
| `sessionFor(host)` / `hostForSession(sessionId)` | Live-session association lookups in both directions. |

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-remote`, which renders the resolved specs, known-host search results, and session close outcomes while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **In-memory dictionary only** — known hosts and live-session associations are process-local and disappear on restart; persistence is deferred until a workflow needs it.
- **No automatic session-death observation** — the directory does not listen to terminal events; a session closed by other means leaves its row until a consumer calls `forget` (the `remote_close` tool does this).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The directory is the Service Definition of the remote-host capability; the providers and the SSH transport live in sibling packages. Known hosts and live-session associations are process-local; persistence is deferred until a workflow needs it.

</details>
