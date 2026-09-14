# The `TerminalSpawnRequest.params` extension (local patch)

The only shared-code change this bundle needs; everything else lives out-of-tree. `dsh plugin add` never applies it. Because upstream's [CONTRIBUTING](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md) does not accept external pull requests while the project is pre-release, this change stays a local patch on the **dsh checkout you run**, applied after dsh install and again after every upgrade that lacks `params`. `typings/dsh-terminal-params.d.ts` mirrors it so the bundle typechecks against unpatched dsh.

## Why it exists

A terminal backend may need per-spawn backend-owned data (here: which remote host to connect to). `TerminalSpawnRequest` carries `type`, `name`, and `cwd`; a consumer cannot pass backend-specific arguments, so an SSH backend would otherwise smuggle them through `cwd` or a side channel. The extension is backward compatible: the field is optional, generic consumers and backends ignore it, and a backend that understands a key reads it.

## The diff (same as `patches/terminal-params.patch`)

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

## Apply after every dsh upgrade

```sh
cd <your-dsh-installation>          # the dsh source checkout whose packages dsh loads
git apply /path/to/dsh-remote-tools/patches/terminal-params.patch
```

If dsh ever ships this extension (upstream opens external contributions), delete `patches/terminal-params.patch` and `typings/dsh-terminal-params.d.ts` and drop this page.
