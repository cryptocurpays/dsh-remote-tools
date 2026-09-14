---
description: "Generic SSH PTY backend for the terminal seam: spawns the system ssh binary, authenticates with a credential, and presents an interactive shell for users and maintainers running remote terminal sessions."
kind: "package-reference"
---

# @zealousw/dsh-terminal-ssh

English | [中文](README.zh.md)

## Summary

Local Service Provider for the `@deepseek-ai/dsh-terminal` transport seam: `SshPtySession` spawns the host `ssh` binary, authenticates with a credential, and presents an interactive shell over a PTY. It is the transport behind the remote tools and the generic terminal tools for SSH sessions.

No invariant companion is published because the backend session state machine is owned by the terminal registry and exercised per operation; no independent snapshot exists for a companion to check.

## Table of Contents

- [Config](#config)
- [Behavior](#behavior)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="config"></a>
## Config

```yaml
- id: terminal-ssh
  name: '@zealousw/dsh-terminal-ssh'
  config:
    backendType: ssh            # registry type (default)
    sshPath: ssh                # SSH executable
    knownHostsPath: ''          # plugin-managed known_hosts; empty disables the override
    tokenRef: JUMPSERVER_PASSWORD  # CredentialRef for the ssh password
    timeoutMs: 30000            # absolute send wait bound
    rows: 40
    cols: 160
    scrollbackLines: 10000
    scrollbackMaxBytes: 4194304
    maxReadBytes: 262144
    disposeGraceMs: 3000        # grace before teardown escalates to SIGKILL
```

<a id="behavior"></a>
## Behavior

- **Spawn** — the backend resolves the host reference to a spec, requires a username (`NEED_USERNAME`), resolves the credential (`NEED_CREDENTIAL`), and runs `ssh -o StrictHostKeyChecking=accept-new [-o UserKnownHostsFile=<path>] -p <port> <username>@<host>`.
- **Password handshake** — after the password prompt appears the backend writes the ssh password and a carriage return, waits for the shell, then performs a sentinel readiness handshake (`echo __DSH_READY__`).
- **Readiness sentinel** — every submitted send appends `; echo __DSH_READY__`; a send settles when the sentinel appears in the scrollback delta as its own output line and output is idle, so a settled viewport contains exactly the new output (the shell's echoed input line carries the marker only as a substring and never settles a send).
- **Bounded reads** — scrollback retains up to `scrollbackLines` lines / `scrollbackMaxBytes` bytes; one read or settled viewport returns at most `maxReadBytes`.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-remote` and the generic terminal tools, which render this backend's settled viewport deltas, wait reasons, and session status while this backend contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **PTY-session machinery runs in parallel with `terminal-bash`** — this backend's sentinel-dialect session state machine mirrors `packages/terminal/terminal-bash` (controlled-PS1 marker plus stdin-wait tracking); the deliberate overlap is jscpd-ignored in source, and a shared extraction waits for the bash backend's planned send-state consolidation.
- **POSIX `ssh` binary required** — the backend shells out to `ssh`; Windows is unsupported until a transport can run without it.
- **Token lifetime bounds the session** — JumpServer connect tokens are single-use; a new spawn consumes one token, so reconnection requires a fresh token from the user.
- **No session resume** — a killed or lost SSH session cannot be resumed; `remote_open` again starts from authentication.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The backend mirrors the bash backend's session state machine in a sentinel dialect; a shared extraction is planned once the bash backend consolidates its send state.

</details>
