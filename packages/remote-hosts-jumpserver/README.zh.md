---
description: "ctx.remoteHosts 的 JumpServer 发现 provider：把 Web UI 的连接命令解析为 RemoteHostSpec，供连接 JumpServer 资产的用户与维护者使用。"
kind: "package-reference"
---

# @zealousw/dsh-remote-hosts-jumpserver

[English](README.md) | 中文

## 概述

`@zealousw/dsh-remote-hosts` 发现 seam 的 Service Provider：本插件把 JumpServer Web UI 复制的 SSH 连接命令解析为 `RemoteHostSpec`。用户名是 `@` 之前携带连接令牌的部分；网关主机与端口来自命令本身，因此无需任何 preset 或 settings 配置。ssh 密码仍存放在凭据存储中（默认 `JUMPSERVER_PASSWORD`）。

不发布不变式 companion：本 provider 是纯命令解析器，每条解析与解析路径都在内联校验，不存在可供 companion 核对的独立运行时快照。

## 目录

- [配置](#config)
- [行为](#behavior)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="config"></a>
## 配置

```yaml
- id: remote-hosts-jumpserver
  name: '@zealousw/dsh-remote-hosts-jumpserver'
  config:
    port: 22222      # default port when the connect command omits -p
    tokenRef: JUMPSERVER_PASSWORD  # CredentialRef for the ssh password
```

<a id="behavior"></a>
## 行为

- **可接受的引用** —— `ssh <user>#<account>#<connect-token>@<host> -p <port>`、去掉 `ssh ` 前缀的同一命令、旧式 `JMS-<uuid>@<host> -p <port>`，以及裸目标 `<user>#<account>#<token>@<host>`（端口取自 config）。
- **无目录条目** —— `search` 返回空列表；连接命令正是用户已从 Web UI 拿到的发现单元，连接成功后被记录的主机会通过目录自身的字典优先出现。
- **从不解析凭据** —— 令牌留在 `tokenRef` 引用的凭据存储中；目录 spec 只携带引用。
- **失败要响亮** —— 无法解析的引用会以 `jumpserver: cannot parse "<ref>" as a connect command; expected "<user>#<account>#<token>@<host>[-p <port>]"` 拒绝。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-remote` 间接影响；该工具会渲染解析出的 spec 与搜索结果，而本 provider 自身不贡献任何提示词或 schema。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **仅限 JumpServer 形状的引用** —— 解析器识别连接命令与裸 `user#account#token@host` 目标；`pass ssh/<name>` 式查找属于未来 provider 的领域。
- **无资产清单搜索** —— 该 provider 无法枚举 JumpServer 资产；发现只能来自粘贴的命令或已知主机字典。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本 provider 是连接命令形状上的纯解析器；它注册到发现目录，除已解析的配置外不保留任何运行时状态。

</details>
