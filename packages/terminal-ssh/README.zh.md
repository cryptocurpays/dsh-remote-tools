---
description: "终端 seam 的通用 SSH PTY 后端：启动系统 ssh 二进制、用凭据认证并呈现交互式 shell，供运行远程终端会话的用户与维护者使用。"
kind: "package-reference"
---

# @zealousw/dsh-terminal-ssh

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-terminal` 传输 seam 的本地 Service Provider：`SshPtySession` 启动宿主机 `ssh` 二进制、用凭据认证，并通过 PTY 呈现交互式 shell。它是远程工具和通用终端工具在 SSH 会话背后的传输层。

不发布不变式 companion：后端会话状态机由终端注册表持有并在每次操作中执行，不存在可供 companion 核对的独立快照。

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
- id: terminal-ssh
  name: '@zealousw/dsh-terminal-ssh'
  config:
    backendType: ssh            # registry type (default)
    sshPath: ssh                # SSH executable
    knownHostsPath: ''          # plugin-managed known_hosts; empty disables the override
    tokenRef: JUMPSERVER_PASSWORD  # CredentialRef for the ssh password
    timeoutMs: 30000            # absolute send wait bound
    rows: 40
    cols: 160
    scrollbackLines: 10000
    scrollbackMaxBytes: 4194304
    maxReadBytes: 262144
    disposeGraceMs: 3000        # grace before teardown escalates to SIGKILL
```

<a id="behavior"></a>
## 行为

- **Spawn** —— 后端把主机引用解析为 spec，要求用户名（`NEED_USERNAME`）、解析凭据（`NEED_CREDENTIAL`），然后运行 `ssh -o StrictHostKeyChecking=accept-new [-o UserKnownHostsFile=<path>] -p <port> <username>@<host>`。
- **密码握手** —— 密码提示出现后，后端写入 ssh 密码并回车，等待 shell，然后执行哨兵就绪握手（`echo __DSH_READY__`）。
- **就绪哨兵** —— 每次提交的发送都会追加 `; echo __DSH_READY__`；当哨兵作为独立输出行出现在滚动缓冲增量中且输出空闲时发送即结算，因此结算后的 viewport 恰好包含新输出（shell 回显的输入行只把标记当作子串携带，永远不会结算发送）。
- **有界读取** —— 滚动缓冲最多保留 `scrollbackLines` 行 / `scrollbackMaxBytes` 字节；单次读取或结算 viewport 最多返回 `maxReadBytes`。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-remote` 与通用终端工具间接影响；它们会渲染此后端结算的 viewport 增量、等待原因与会话状态，而后端自身不贡献任何提示词或 schema。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **PTY 会话机制与 `terminal-bash` 刻意平行** —— 此后端的哨兵方言会话状态机与 `packages/terminal/terminal-bash`（controlled-PS1 标记加 stdin-wait 跟踪）互为镜像；这一有意的重叠在源码中以 jscpd 忽略标注，共享提取要等 bash 后端计划的 send-state 整合落地。
- **需要 POSIX `ssh` 二进制** —— 后端通过子进程调用 `ssh`；在找到无需它的传输之前不支持 Windows。
- **令牌寿命限定会话** —— JumpServer 连接令牌一次性使用；每次新 spawn 消耗一个令牌，因此重连需要用户提供新令牌。
- **无会话恢复** —— 被杀掉或丢失的 SSH 会话无法恢复；再次 `remote_open` 需要从认证重新开始。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本后端以哨兵方言镜像 bash 后端的会话状态机；等 bash 后端整合其 send 状态后计划做一次共享提取。

</details>
