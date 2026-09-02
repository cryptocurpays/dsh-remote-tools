# 本地挂载备忘：在这台机器的 dsh 里使用 remote 工具

> 个人维护备忘（中文）。记录如何把本 bundle 挂载进以源码形态运行的 dsh 工作区
> （`/Users/Jeremy/deepseek-harness`），以及每次拉上游新 master 后要做的维护动作。
> 前提：本机 dsh 以**源码/tsx 模式**运行（GUI 由 `pnpm dsh web` 启动）。

## 0. 本地挂载层包含什么（全部刻意不提交）

| 改动 | 位置 | 原因 |
|---|---|---|
| terminal 6 行补丁 | `packages/terminal/terminal/src/{types,index}.ts` | 让 `ctx.terminals.spawn` 运行时转发 `params`（上游不接受外部 PR） |
| 5 个包的挂载拷贝 | 未跟踪目录 `packages/remote-tools/` | workspace 成员，入口指向 `src/index.ts`，tsx 直载无需构建 |
| apps/cli 5 个依赖 | `apps/cli/package.json`（`@cryptocurpays/*@workspace:^`） | 让 Loader 按名解析 5 个插件 |
| lockfile | `pnpm-lock.yaml` | 随安装更新 |

## 1. 首次挂载（已经做过，留档）

```sh
cd /Users/Jeremy/deepseek-harness

# ① terminal 补丁（6 行，文档见 ~/dsh-remote-tools/docs/terminal-params-patch.md）
git apply /Users/Jeremy/dsh-remote-tools/patches/terminal-params.patch

# ② 拷贝 5 个包为本地 workspace 成员
mkdir -p packages/remote-tools
for p in remote-hosts remote-hosts-jumpserver remote-hosts-file terminal-ssh tool-remote; do
  cp -R /Users/Jeremy/dsh-remote-tools/packages/$p packages/remote-tools/$p
done
# ③ 把每个拷贝的 package.json 入口指向 src（tsx 源模式直载，免构建）
node -e '
const { readFileSync, writeFileSync } = require("node:fs");
for (const p of ["remote-hosts","remote-hosts-jumpserver","remote-hosts-file","terminal-ssh","tool-remote"]) {
  const f = "packages/remote-tools/" + p + "/package.json";
  const m = JSON.parse(readFileSync(f, "utf8"));
  m.main = "src/index.ts"; m.types = "src/index.ts";
  m.exports = { ".": { types: "./src/index.ts", default: "./src/index.ts" }, "./package.json": "./package.json" };
  writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
}'

# ④ apps/cli/package.json 的 dependencies 加入 5 行：
#   "@cryptocurpays/dsh-remote-hosts": "workspace:^",
#   "@cryptocurpays/dsh-remote-hosts-file": "workspace:^",
#   "@cryptocurpays/dsh-remote-hosts-jumpserver": "workspace:^",
#   "@cryptocurpays/dsh-terminal-ssh": "workspace:^",
#   "@cryptocurpays/dsh-tool-remote": "workspace:^",

# ⑤ 安装链接
CI=true pnpm install --no-frozen-lockfile

# ⑥ 验证解析（应全部打印 apply: function）
cd apps/cli && node --import tsx/esm -e "Promise.all([
  import('@cryptocurpays/dsh-remote-hosts'),
  import('@cryptocurpays/dsh-remote-hosts-jumpserver'),
  import('@cryptocurpays/dsh-remote-hosts-file'),
  import('@cryptocurpays/dsh-terminal-ssh'),
  import('@cryptocurpays/dsh-tool-remote')]).then(ms =>
  console.log(ms.map(m => typeof (m.default?.apply ?? m.apply)).join(' '))).catch(e => { console.error(e.message); process.exit(1) })"
```

## 2. 启动并验证

```sh
# 重启 GUI（必须带 --patch）
pnpm dsh web --patch /Users/Jeremy/dsh-remote-tools/cordis.patch.yml
```

验证：在对话里让 agent 执行 `remote_search`——返回你 `remote-hosts.yaml`
（默认 `$DSH_HOME/remote-hosts.yaml`）配置的主机即挂载成功。
`remote_open`/`remote_exec` 还需凭据存储里有对应 tokenRef 的密码 + 主机可达。

## 3. 每次拉上游新 master 后的维护动作

```sh
git pull --ff-only origin master          # 或 merge
git apply /Users/Jeremy/dsh-remote-tools/patches/terminal-params.patch   # 重打 6 行
# 若 patch 冲突（上游动过 terminal 同段）：手工补回同样的 6 行
# 若 apps/cli/package.json pull 冲突：重新加入第 ④ 步那 5 行依赖
# 用 bundle 最新代码刷新挂载拷贝（保持与 bundle 同步）：
rm -rf packages/remote-tools && mkdir packages/remote-tools
for p in remote-hosts remote-hosts-jumpserver remote-hosts-file terminal-ssh tool-remote; do
  cp -R /Users/Jeremy/dsh-remote-tools/packages/$p packages/remote-tools/$p; done
# （重复第 ③ 步的 node 片段改入口）
CI=true pnpm install --no-frozen-lockfile
pnpm dsh web --patch /Users/Jeremy/dsh-remote-tools/cordis.patch.yml   # 重启
```

## 4. 卸载（恢复干净工作区）

```sh
rm -rf packages/remote-tools
git checkout -- apps/cli/package.json      # 撤销 5 行依赖（会连别的未提交改动一起还原，注意）
git checkout -- packages/terminal/terminal/src/types.ts packages/terminal/terminal/src/index.ts  # 撤销补丁
CI=true pnpm install --no-frozen-lockfile  # 重链接 lockfile/node_modules
git status                                  # 应只剩你自己的未跟踪文件
```

## 5. 已知限制 / 备注

- **npm 发布路线暂不可行**：npm 上 `@deepseek-ai/dsh-*` 只有远古的 `0.0.1-rc.3`
  （当前代码 0.1.2-alpha.4+ 未发布），bundle 无法声明真实版本依赖。等上游发布新版本后，
  再走"bundle 转真实版本 → 发布 → `dsh --profile ... --plugin add`"路线。
- **terminal 补丁是永久本地机制**（上游 CONTRIBUTING：pre-release 阶段不接受外部 PR），
  见 `docs/terminal-params-patch.md`。
- bundle 仓库（`~/dsh-remote-tools` + GitHub）是**源码与文档的权威来源**；
  工作区 `packages/remote-tools/` 只是可再生的挂载拷贝。
- 本机全局 gitignore 的 `*.md` 规则已删除（此前导致 markdown 无法提交）。
