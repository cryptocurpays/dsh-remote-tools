# Install via `dsh plugin add`

English companion to [README.md](../README.md). Mount the bundle as a profile layer instead of passing `--patch` on every launch.

## Prerequisites

- A working `dsh` CLI (built or installed from DeepSeek Harness).
- Node.js matching the harness engines range (^22.19 or >=24).

The terminal `params` extension ships in current upstream `dsh-terminal`; no local patch is required for new harness checkouts.

## One-time profile setup

Create a profile from the Web template (name it as you prefer). `--dump-config` prints the composed tree and exits so this step does not boot the Web UI:

```sh
dsh --profile web-remote --from-default-profile web --dump-config
```

## Install the bundle

From any directory, add the published npm bundle (a local checkout, `pnpm pack` tarball, or GitHub spec also works):

```sh
dsh plugin --profile web-remote add @zealousw/dsh-remote-tools
```

npm scope is `@zealousw`. The source repository remains `github:cryptocurpays/dsh-remote-tools` and can be used before the npm release.

`pnpm` runs the bundle's `prepare` script, which transpiles each plugin package to `lib/index.js`. On pnpm ≥10, the first git install may require an `allowBuilds` entry in the profile's `pnpm-workspace.yaml`; copy the key `dsh` prints and re-run the command.

The `--dump-config` on profile creation only shows the Web template. After `plugin add`, dump again if you want to confirm the bundle layer (optional — boot also fails loud if a row is missing):

```sh
dsh --profile web-remote --dump-config
```

Expect a `# == @zealousw/dsh-remote-tools` layer with the terminal seam plus five plugin rows.

The Web template does not ship `@deepseek-ai/dsh-terminal`. This bundle inserts that row so the SSH backend can register. If you add the bundle to a profile that already has `id: terminal`, remove the duplicate from that profile's `cordis.patch.yml`.

## Run

```sh
dsh --profile web-remote
```

## Update or remove

```sh
dsh plugin --profile web-remote update @zealousw/dsh-remote-tools
dsh plugin --profile web-remote remove @zealousw/dsh-remote-tools
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
