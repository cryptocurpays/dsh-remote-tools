---
description: "JumpServer discovery provider for ctx.remoteHosts: parses the web-UI connect command into a RemoteHostSpec for users and maintainers connecting to JumpServer assets."
kind: "package-reference"
---

# @zealousw/dsh-remote-hosts-jumpserver

English | [中文](README.zh.md)

## Summary

Service Provider for the `@zealousw/dsh-remote-hosts` discovery seam: the plugin parses the SSH connect command the JumpServer web UI copies into a `RemoteHostSpec`. The username is the connect-token-bearing part before `@`; the gateway host and port come from the command itself, so no preset or settings configuration is required. The ssh password still lives in the credentials store (`JUMPSERVER_PASSWORD` by default).

No invariant companion is published because the provider is a pure command parser: every parse and resolve path is validated inline, so no independent runtime snapshot exists for a companion to check.

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
- id: remote-hosts-jumpserver
  name: '@zealousw/dsh-remote-hosts-jumpserver'
  config:
    port: 22222      # default port when the connect command omits -p
    tokenRef: JUMPSERVER_PASSWORD  # CredentialRef for the ssh password
```

<a id="behavior"></a>
## Behavior

- **Accepted references** — `ssh <user>#<account>#<connect-token>@<host> -p <port>`, the same command without the `ssh ` prefix, the legacy `JMS-<uuid>@<host> -p <port>`, and a bare `<user>#<account>#<token>@<host>` (port from config).
- **No catalog entries** — `search` returns an empty list; the connect command is the discovery unit the user already has from the web UI, and hosts recorded after a successful connection appear first via the directory's own dictionary.
- **Credentials never parsed** — the token stays in the credential store referenced by `tokenRef`; the directory spec carries the reference only.
- **Loud failures** — an unparseable reference rejects with `jumpserver: cannot parse "<ref>" as a connect command; expected "<user>#<account>#<token>@<host>[-p <port>]"`.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-remote`, which renders the resolved spec and search results while this provider contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **JumpServer-shaped references only** — the parser recognizes connect commands and bare `user#account#token@host` targets; `pass ssh/<name>` style lookups are the domain of a future provider.
- **No inventory search** — the provider cannot enumerate JumpServer assets; discovery works from a pasted command or the known-host dictionary.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The provider is a pure parser over the connect command shape; it registers on the discovery directory and keeps no runtime state beyond the resolved configuration.

</details>
