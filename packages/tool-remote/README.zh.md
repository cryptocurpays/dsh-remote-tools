---
description: "面向模型的远程主机工具，建立在发现 seam 与传输 seam 之上：搜索 provider、打开持久 ssh 会话、执行一次性远程命令，供把远程工作委托给 agent 的用户使用。"
kind: "package-reference"
---

# @zealousw/dsh-tool-remote

[English](README.md) | 中文

## 概述

面向模型的远程主机工具，建立在发现 seam 与传输 seam 之上。本包同时拥有 `ctx.remoteHosts` 与 `ctx.terminals` 的 Consumer 角色：`remote_search` 列出非机密主机元数据，`remote_open` 发布持久 SSH 会话并把远程主机名记入已知主机字典，`remote_exec` 通过临时会话执行一条有界命令，`remote_close` 关闭一个持久会话并遗忘其主机，`remote_close_all` 关闭该 agent 拥有的全部 ssh 会话并清除它们在字典中的主机。凭据从不出现在工具参数或结果中——发现 spec 携带一个由后端解析的 `CredentialRef`。

不发布不变式 companion：本工具仅路由到发现与终端注册表，后者在每次调用时校验所有权与结果，不存在可供 companion 核对的独立快照。

## 目录

- [工具](#tools)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="tools"></a>
## 工具

| 工具 | 行为 |
|---|---|
| `remote_search(query)` | 列出匹配的非机密 spec（`name`、`host`、`port`、可选 `username`）；已知主机优先。 |
| `remote_open(hostRef, name?)` | 从粘贴的 JumpServer 连接命令、已配置的主机名（file provider）或任何 `remote_search` 结果创建持久的 owner 隔离 SSH 连接；通过 `hostname` 学习远程主机名（尽力而为，5 秒上界）并把主机与会话 id 一起记入字典。 |
| `remote_exec(hostRef \| sessionId, command, timeoutMs?)` | 执行一条有界命令；`sessionId`（来自 `remote_open`）复用已打开的连接、零重认证，`hostRef` 打开命令结束后即关闭的临时会话。返回真实 `exitCode`（通过 `__DSH_EXIT__` 标记捕获）、`stdout`、`waitReason`、`truncated`。 |
| `remote_close(sessionId)` | 杀掉会话并从已知主机字典中遗忘其主机。 |
| `remote_close_all()` | 关闭调用 agent 拥有的全部持久 ssh 会话并遗忘其主机；非 ssh 会话不受影响。返回 `closed` 与 `hosts`。 |

该 consumer 还注册一个 `tool:remote` 系统提示词 section，指导主机发现与会话卫生。

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型所见

本插件注册作用域内的每个请求都包含下方指导，它引导主机发现与会话生命周期。

##### 远程指导

```markdown
Create a remote connection with remote_open, passing a pasted JumpServer connect command or a remote_search result as hostRef. Run commands on it with remote_exec (reuse its sessionId for zero re-authentication) or the terminal tools. Track and close every session id; remote_close_all closes them all at once.
```

#### Token 影响

插件激活期间每个请求都有少量固定输入成本，与访问哪台远程主机无关。

#### KV Cache 影响

在注册作用域与提示词文本不变的前提下前缀稳定；插件的激活或销毁可能使该提示词 section 的复用失效。

### 工具 schema

#### 模型所见

模型看到五个 [`tool-remote` schema](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.zh.md#deepseek-aidsh-tool-remote)：`remote_search`、`remote_open`、`remote_exec`、`remote_close` 与 `remote_close_all`，字段与上文完全一致。

#### Token 影响

工具可见的每个请求都有固定的 schema 成本。

#### KV Cache 影响

在可见性与五个定义不变的前提下前缀稳定；配置变更或限制可能使首个被改动定义的复用失效。

### 结果

#### 模型所见

`remote_search` 返回非机密元数据的 JSON 数组。`remote_open` 返回供通用终端工具使用的会话事实（`sessionId`、`type`、`pid`、`status`、`motd`）。`remote_exec` 以 `stdout` 返回结算 viewport，附真实 `exitCode`（命令被 `__DSH_EXIT__` 标记包裹；无标记存活时回退到传输的退出状态）、`waitReason` 与 `truncated`；viewport 受传输的 `maxReadBytes`（默认 256 KiB）约束。`remote_close` 返回 `closed`，若会话当时活跃还返回被遗忘的 `host`。`remote_close_all` 返回关闭的会话数与主机列表，若没有打开的远程会话则如实报告。

#### Token 影响

调用前结果 token 为零；一次调用的输出随数据变化，并受传输读取上限约束。

#### KV Cache 影响

只追加；新可见内容跟在可复用的请求前缀之后，不会使既有 KV Cache 条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **结果依赖传输上界** —— 模型可见的输出上限来自所挂载后端的 `maxReadBytes`；工具本身不施加独立上限。
- **孤儿会话无自动清理** —— 若持久会话在 `remote_close` 之外消亡，其已知主机行会保留到某个 consumer 遗忘它或进程重启。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

这些工具是发现与终端注册表之上的薄 consumer；会话所有权与结果校验留在那些 seam 中。

</details>
