# 本地挂载备忘（已退役）

源码挂载（把 5 个包拷进 `deepseek-harness/packages/remote-tools`、改 `apps/cli` 依赖、再用 `pnpm dsh web --patch`）已经退役。

当前路径：用已构建的 `dsh` CLI，把本仓库作为 bundle 装进 profile。步骤见 [install.md](install.md)。

```sh
dsh --profile web-remote --from-default-profile web --dump-config
dsh plugin --profile web-remote add @cryptocurpays/dsh-remote-tools
dsh --profile web-remote
```

未发 npm 前可用 `github:cryptocurpays/dsh-remote-tools`。

Web 模板不含 `dsh-terminal`；bundle 的 `cordis.patch.yml` 会插入该 seam。若把 bundle 加到已经手写了 `id: terminal` 的 profile，删掉 profile patch 里的重复行。

`dsh plugin add` 不会改 dsh。官方 `dsh-terminal` 若不转发 `params`，`remote_open` 会失败。在跑 bundle 之前，对**实际启动的那份 dsh 源码**执行 `git apply patches/terminal-params.patch`（说明见 [terminal-params-patch.md](terminal-params-patch.md)）。该 checkout 若已有 `TerminalSpawnRequest.params` 可跳过。
