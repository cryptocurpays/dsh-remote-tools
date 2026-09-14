---
description: "远程主机发现 seam（ctx.remoteHosts）：provider 注册表、主机引用解析、已知主机字典与活跃会话映射，供选择或扩展远程连接的用户与维护者使用。"
kind: "package-reference"
---

# @cryptocurpays/dsh-remote-hosts

[English](README.md) | 中文

## 概述

**`RemoteHostDirectory`**（`ctx.remoteHosts`）定义了 harness 如何找到值得连接的远程主机——JumpServer 资产、pass store 的 `ssh` 条目，或其他任何 provider 宣告的内容——而不把模型契约绑定到某一种资产清单的格式上。

不发布不变式 companion：目录在每次注册时校验 provider id 与唯一性，且不发布可供 companion 交叉核对的独立快照。

本包拥有远程主机发现能力的 Service Definition 角色：

| 包 | 角色 |
|---|---|
| `@cryptocurpays/dsh-remote-hosts`（本包） | Service Definition：provider 注册表、解析、已知主机字典、活跃会话映射 |
| `@cryptocurpays/dsh-remote-hosts-jumpserver` | Provider：解析粘贴的 JumpServer SSH 连接命令 |
| `@cryptocurpays/dsh-remote-hosts-file` | Provider：来自 `~/.dsh/remote-hosts.yaml` 的静态测试服务器 |
| `@cryptocurpays/dsh-terminal-ssh` | 传输：`ctx.terminals` 的 SSH PTY 后端 |
| `@cryptocurpays/dsh-tool-remote` | Consumer：面向模型的 `remote_search` / `remote_open` / `remote_exec` / `remote_close` 工具 |

`RemoteHostSpec` 只携带非机密的连接事实（`name`、`host`、`port`、可选的 `username`）外加一个 `CredentialRef`；凭据值从不进入目录。

## 目录

- [Service API（`ctx.remoteHosts`）](#service-api-ctxremotehosts)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="service-api-ctxremotehosts"></a>
## Service API（`ctx.remoteHosts`）

| 成员 | 语义 |
|---|---|
| `registerProvider(provider)` / `listProviders()` | 注册一个 provider；返回的 disposer 恰好移除该贡献（effect 绑定，HMR 安全）。重复 id 时抛出 `RemoteHostError` `DUPLICATE_PROVIDER`。 |
| `resolve(ref)` | 运行第一个匹配的 provider。无匹配时抛出 `RemoteHostError` `NO_PROVIDER`，或抛出该 provider 自身的拒绝。 |
| `search(query)` | 合并非机密 spec：先列已知主机，按名称去重，再按注册顺序列出 providers。 |
| `remember(spec, sessionId?)` | 记录一台连接成功的主机；同一主机的后续记录替换先前记录（最后一次连接生效）。 |
| `forget(host)` / `forgetAll()` | 移除一台或全部已知主机，并丢弃其活跃会话关联。 |
| `sessionFor(host)` / `hostForSession(sessionId)` | 双向暴露活跃会话关联。 |

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-remote` 间接影响；该工具会渲染解析出的 spec、已知主机搜索结果与会话关闭结果，而本注册表自身不贡献任何提示词或 schema。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **仅内存字典** —— 已知主机与活跃会话关联仅存在于进程内，重启后消失；持久化在需要它的工作流出现之前暂缓。
- **不自动观察会话消亡** —— 目录不监听终端事件；通过其他方式关闭的会话会保留其行，直到某个 consumer 调用 `forget`（`remote_close` 工具会这样做）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

目录是远程主机能力的 Service Definition；provider 与 SSH 传输层位于同级包。已知主机与活跃会话关联仅存在于进程内；持久化在需要它的工作流出现之前暂缓。

</details>
