# 本地挂载备忘（已退役）

源码挂载（把 5 个包拷进 `deepseek-harness/packages/remote-tools`、改 `apps/cli` 依赖、再用 `pnpm dsh web --patch`）已经退役。

当前路径：用已构建的 `dsh` CLI，把本仓库作为 bundle 装进 profile。步骤见 [install.md](install.md)。

```sh
dsh --profile web-remote --from-default-profile web --dump-config
dsh plugin --profile web-remote add github:cryptocurpays/dsh-remote-tools
dsh --profile web-remote
```

Web 模板不含 `dsh-terminal`；bundle 的 `cordis.patch.yml` 会插入该 seam。若把 bundle 加到已经手写了 `id: terminal` 的 profile，删掉 profile patch 里的重复行。

`patches/terminal-params.patch` 仅用于尚未包含 `params` 的旧 dsh；当前 upstream `dsh-terminal` 已带该扩展。
