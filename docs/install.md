# Install via `dsh plugin add`

English companion to [README.md](../README.md). Mount the bundle as a profile layer instead of passing `--patch` on every launch.

## Prerequisites

- A working `dsh` CLI (built or installed from DeepSeek Harness).
- Node.js matching the harness engines range (^22.19 or >=24).

The terminal `params` extension ships in current upstream `dsh-terminal`; no local patch is required for new harness checkouts.

## One-time profile setup

Create a profile from the Web template (name it as you prefer):

```sh
dsh --profile web-remote --from-default-profile web
```

## Install the bundle

From any directory, add this repository checkout (or a `pnpm pack` tarball):

```sh
dsh plugin --profile web-remote add /path/to/dsh-remote-tools
```

`pnpm` runs the bundle's `prepare` script, which transpiles each plugin package to `lib/index.js`. On pnpm ≥10, the first git install may require an `allowBuilds` entry in the profile's `pnpm-workspace.yaml`; copy the key `dsh` prints and re-run the command.

Verify the composed configuration:

```sh
dsh --profile web-remote --dump-config
```

Expect a `# == @cryptocurpays/dsh-remote-tools` layer with the terminal seam plus five plugin rows.

The Web template does not ship `@deepseek-ai/dsh-terminal`. This bundle inserts that row so the SSH backend can register. If you add the bundle to a profile that already has `id: terminal`, remove the duplicate from that profile's `cordis.patch.yml`.

## Run

```sh
dsh --profile web-remote
```

## Update or remove

```sh
dsh plugin --profile web-remote update @cryptocurpays/dsh-remote-tools
dsh plugin --profile web-remote remove @cryptocurpays/dsh-remote-tools
```

After pulling bundle changes, rebuild before re-installing if you bypass `prepare` (for example when copying sources manually):

```sh
cd /path/to/dsh-remote-tools
pnpm run build
```

## Development build

Typecheck still uses the machine-local harness path map in `tsconfig.base.json`. Emit for install/profile use is separate:

```sh
pnpm run build        # esbuild → packages/*/lib/index.js
pnpm run typecheck    # harness-backed static check
pnpm run test         # vitest against source (needs harness node_modules)
```

Before publishing to npm, replace `peerDependencies` `"*"` ranges with semver that matches the released `@deepseek-ai/dsh-*` versions you support.
