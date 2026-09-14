# @zealousw/dsh-remote-tools

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

## Install (recommended)

Install the bundle into a profile with `dsh plugin add` so every plugin resolves through the profile's `node_modules` without `--patch`:

```sh
dsh --profile web-remote --from-default-profile web --dump-config   # create profile, print, exit (no remote-* rows yet)
dsh plugin --profile web-remote add github:cryptocurpays/dsh-remote-tools
dsh --profile web-remote --dump-config   # optional: expect terminal + five remote-* plugin rows
dsh --profile web-remote
```

Step-by-step notes: [docs/install.md](docs/install.md). The root package's `prepare` script transpiles each plugin to `lib/index.js` during install.

## Dev overlay (optional)

While developing against a source checkout of dsh:

```sh
dsh web --patch /path/to/dsh-remote-tools/cordis.patch.yml
```

## Upgrade workflow (when a new dsh releases)

1. Pull the new dsh into your environment.
2. Run this bundle's checks (below).
3. Fix only if a seam API you use changed (`ctx.tools`, `ctx.terminals`, `ctx.credentials`, `ctx.systemPrompt`) — rare and usually one call site.
4. Re-install or update the profile bundle: `dsh plugin --profile web-remote update @zealousw/dsh-remote-tools`.

## Development

The bundle typechecks and tests against a local dsh checkout **read-only**; it never modifies it. `tsconfig.base.json` maps every `@deepseek-ai/*` name to harness source paths — machine-local by design. Install-time emit uses esbuild and keeps `@deepseek-ai/*` external so the running dsh satisfies peers.

```sh
cd /path/to/dsh-remote-tools
pnpm install          # needs harness node_modules symlink or a local install
pnpm run build        # packages/*/lib/index.js
pnpm run typecheck
pnpm run test   # from harness: pnpm exec vitest run --config /path/to/dsh-remote-tools/vitest.config.ts packages
```

Before publishing to npm, replace `"*"` peer ranges with semver that matches the released `@deepseek-ai/dsh-*` versions you support.

## Mounting into a source-mode dsh checkout

Do not copy packages into a harness tree. Build or link `dsh`, then follow [docs/install.md](docs/install.md). The old workspace-member mount is retired; [docs/local-mount.md](docs/local-mount.md) only records that.
