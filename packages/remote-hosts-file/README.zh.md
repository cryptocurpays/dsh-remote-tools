---
description: "ctx.remoteHosts 的文件后端发现 provider：把 YAML 文档中的静态测试服务器变成可解析的主机引用，供配置远程连接的用户与维护者使用。"
kind: "package-reference"
---

# @cryptocurpays/dsh-remote-hosts-file

[English](README.md) | 中文

## 概述

`@cryptocurpays/dsh-remote-hosts` 发现 seam 的 Service Provider：把 YAML 文档里列出的静态测试服务器（`name`、`host`、`port`、`username`、`tokenRef`）变成可解析的主机引用，因此 `remote_open(hostRef: "test01")` 无需粘贴连接命令即可连接。密码从不写入文档——每个条目的 `tokenRef` 引用凭据存储中的一项凭据，由传输层在密码提示处解析，模型永远看不到机密。

不发布不变式 companion：本 provider 在加载时校验文档中的每个条目，且不保留可供 companion 交叉核对的独立运行时状态。

## 目录

- [配置](#config)
- [主机文档](#host-document)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="config"></a>
## 配置

```yaml
- id: remote-hosts-file
  name: '@cryptocurpays/dsh-remote-hosts-file'
  config:
    path: ~/.dsh/remote-hosts.yaml   # default: $DSH_HOME/remote-hosts.yaml
```

<a id="host-document"></a>
## 主机文档

```yaml
hosts:
  - name: test01
    host: 10.0.20.214
    port: 36626
    username: root
    tokenRef: TEST01_SSH_PASSWORD
```

- **仅限非机密** —— 文档只放 name/host/port/username 与凭据引用 `tokenRef`；密码值归凭据存储，因此即使模型读到这份文档也学不到任何机密。
- **热重载** —— 每次 `search`/`resolve` 都会重新读取文档；改动在下次连接即生效，无需重启。
- **失败要响亮** —— 文档无效、条目畸形或名字未知都会以指明路径与补救办法的消息拒绝（补条目，或粘贴连接命令）。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-remote` 间接影响；该工具会渲染配置的主机 spec 与搜索结果，而本 provider 自身不贡献任何提示词或 schema。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **仅限裸名字** —— 该 provider 解析主机名；粘贴的连接命令属于 jumpserver provider 的领域，`user@host` 引用不被识别。
- **一个实例对应一份文档** —— 第二个文件需要第二个 provider 行并配置各自的 `path`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本 provider 在每次查找时重新读取文档，并在加载时校验每个条目，因此编辑后的文档无需重启即可生效。

</details>
