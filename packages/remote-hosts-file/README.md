---
description: "File-backed discovery provider for ctx.remoteHosts: static test servers from a YAML document become resolvable host references for users and maintainers configuring remote connections."
kind: "package-reference"
---

# @cryptocurpays/dsh-remote-hosts-file

English | [中文](README.zh.md)

## Summary

Service Provider for the `@cryptocurpays/dsh-remote-hosts` discovery seam: static test servers listed in a YAML document (`name`, `host`, `port`, `username`, `tokenRef`) become resolvable host references, so `remote_open(hostRef: "test01")` works without a pasted connect command. Passwords never live in the document — each entry's `tokenRef` names a credential in the credentials store, resolved by the transport at the password prompt, so the model never sees a secret.

No invariant companion is published because the provider validates every document entry at load and keeps no independent runtime state a companion could cross-check.

## Table of Contents

- [Config](#config)
- [Host document](#host-document)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="config"></a>
## Config

```yaml
- id: remote-hosts-file
  name: '@cryptocurpays/dsh-remote-hosts-file'
  config:
    path: ~/.dsh/remote-hosts.yaml   # default: $DSH_HOME/remote-hosts.yaml
```

<a id="host-document"></a>
## Host document

```yaml
hosts:
  - name: test01
    host: 10.0.20.214
    port: 36626
    username: root
    tokenRef: TEST01_SSH_PASSWORD
```

- **Non-secret only** — the document holds name/host/port/username and a credential `tokenRef`; the password value belongs in the credentials store under that reference, so a model that reads the document learns nothing secret.
- **Hot reload** — every `search`/`resolve` re-reads the document; edits apply to the next connection without a restart.
- **Loud failures** — an invalid document, a malformed entry, or an unknown name rejects with a message naming the path and the remedy (add the entry, or paste a connect command).

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-remote`, which renders the configured host specs and search results while this provider contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Bare names only** — the provider resolves host names; pasted connect commands stay the jumpserver provider's domain, and `user@host` references are not recognized.
- **One document per instance** — a second file needs a second provider row with its own `path`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The provider re-reads its document on every lookup and validates each entry at load, so an edited document applies without a restart.

</details>
