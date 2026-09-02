# @cryptocurpays/dsh-remote-tools

Out-of-tree dsh bundle: **remote-host tools** — discovery, an SSH terminal backend, and model-facing tools — mounted beside the shipped dsh profiles instead of inside the upstream tree. This keeps upstream upgrades cheap: the bundle only tracks the public seams it uses, never the upstream codebase's internal structure.

## What it contains

| Package | Role |
|---|---|
| [`packages/remote-hosts`](packages/remote-hosts/README.md) | Service Definition: `ctx.remoteHosts` discovery directory (provider registry, resolution, known-host dictionary, live-session map) |
| [`packages/remote-hosts-jumpserver`](packages/remote-hosts-jumpserver/README.md) | Provider: parses pasted JumpServer SSH connect commands |
| [`packages/remote-hosts-file`](packages/remote-hosts-file/README.md) | Provider: static test servers from a YAML document |
| [`packages/terminal-ssh`](packages/terminal-ssh/README.md) | Transport: SSH PTY backend registered on `ctx.terminals` |
| [`packages/tool-remote`](packages/tool-remote/README.md) | Consumer: `remote_search` / `remote_open` / `remote_exec` / `remote_close` / `remote_close_all` tools |

`cordis.patch.yml` is the bundle overlay that mounts all five.

## Prerequisite: the terminal `params` extension

The SSH backend receives the target host through `TerminalSpawnRequest.params`, which upstream's `dsh-terminal` does not ship. Upstream's [CONTRIBUTING](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md) states it **cannot accept external pull requests while the project is pre-release**, so this 6-line extension stays as a local patch (see [patches/terminal-params.patch](patches/terminal-params.patch) and [docs/terminal-params-patch.md](docs/terminal-params-patch.md)). Apply it to the installed `dsh-terminal` package after every dsh upgrade:

```sh
cd <your-dsh-installation>
git apply /path/to/dsh-remote-tools/patches/terminal-params.patch   # paths are relative to the dsh repo root
```

`typings/dsh-terminal-params.d.ts` mirrors the same change so this bundle typechecks against unpatched types; keep both until upstream opens external contributions (watch CONTRIBUTING.md).

## Install

Publish or link the five packages so the names resolve in your dsh environment, then mount the overlay:

```sh
dsh web --patch /path/to/dsh-remote-tools/cordis.patch.yml
```

or install the packages into a custom profile (`dsh --profile <name> --plugin add <pkg>`).

## Upgrade workflow (when a new dsh releases)

1. Pull the new dsh into your environment.
2. Re-apply `patches/terminal-params.patch` (required until upstream accepts external contributions).
3. Run this bundle's checks (below).
4. Fix only if a seam API you use changed (`ctx.tools`, `ctx.terminals`, `ctx.credentials`, `ctx.systemPrompt`) — rare and usually one call site.

## Development

The bundle typechecks and tests against a local dsh checkout **read-only**; it never modifies it. `tsconfig.base.json` maps every `@deepseek-ai/*` name to `/Users/Jeremy/deepseek-harness` source paths — machine-local by design. A published build instead installs the real dsh packages and uses plain node resolution.

Run from the dsh workspace (which provides `tsc` and `vitest`):

```sh
# typecheck the whole bundle
pnpm exec tsc --noEmit -p /Users/Jeremy/dsh-remote-tools/tsconfig.base.json

# run all package tests
pnpm exec vitest run --config /Users/Jeremy/dsh-remote-tools/vitest.config.ts /Users/Jeremy/dsh-remote-tools/packages
```

Before publishing to npm, convert the `workspace:^` peer/dev dependency ranges in each `packages/*/package.json` to real versions (`@deepseek-ai/cordis@^4.0.2`, `@deepseek-ai/dsh-*@^0.1.2-alpha.4`, ...). Note that upstream has only published `0.0.1-rc.3` of the `@deepseek-ai/dsh-*` packages so far, so real-version installs must wait for an upstream release.

## Mounting into a source-mode dsh checkout (this machine)

To use the remote tools inside a local dsh that runs from a source checkout (`pnpm dsh web`), see the step-by-step local-mount memo: [docs/local-mount.md](docs/local-mount.md) — terminal patch, workspace-member copies, apps/cli dependencies, restart with `--patch`, and the per-upstream-upgrade maintenance routine.
