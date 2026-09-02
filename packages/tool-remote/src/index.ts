/**
 * Model-facing remote host tools over the discovery and terminal seams.
 *
 * This package owns the Consumer role for both the `ctx.remoteHosts`
 * discovery seam and the `ctx.terminals` transport seam: `remote_search`
 * lists non-secret host metadata, `remote_open` publishes a persistent ssh
 * session, `remote_exec` runs one bounded command through a temporary
 * session, and `remote_close`/`remote_close_all` close one or every owned
 * session. Credentials never appear in tool arguments or results — the
 * discovery spec carries a `CredentialRef` resolved by the backend.
 *
 * @module @cryptocurpays/dsh-tool-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@cryptocurpays/dsh-remote-hosts'
import type { TerminalSessionId, TerminalSpawnResult } from '@deepseek-ai/dsh-terminal'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'tool-remote'
/** Required services: tool registry, discovery seam, transport seam, prompt assembly. */
export const inject = ['tools', 'terminals', 'remoteHosts', 'systemPrompt']

function requireAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('remote tools require an initiating agent')
  return agent
}

/**
 * Learn the remote hostname from a freshly opened session by running
 * `hostname`. Best-effort: returns `undefined` on timeout or a send error so
 * connection setup never fails because of hostname discovery.
 * @param ctx - context carrying the terminal seam.
 * @param agent - exact session owner.
 * @param sessionId - the opened session.
 * @param signal - cancellation for the send.
 * @returns the trimmed remote hostname, or `undefined` when unavailable.
 */
async function readRemoteHostname(
  ctx: import('@deepseek-ai/cordis').Context,
  agent: Agent,
  sessionId: import('@deepseek-ai/dsh-terminal').TerminalSessionId,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const operation = ctx.terminals.startSend(agent, sessionId, { text: 'hostname', submit: true, ...signal !== undefined ? { signal } : {} })
    const result = await Promise.race([
      operation.done,
      new Promise<undefined>(resolve => setTimeout(resolve, 5_000)),
    ])
    if (result === undefined) return undefined
    const viewport = result.viewport
    // Strip the echoed command, the sentinel, and any prompt line.
    const lines = viewport.split(/\r?\n/).filter(l => l.length > 0 && !l.includes('__DSH_READY__'))
    const hostname = lines.find(l => !l.startsWith('hostname') && !/^\[[^\]]+\]/.test(l))
    return hostname?.trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Parse the `__DSH_EXIT__=<code>` marker a wrapped command emits immediately
 * before the transport's readiness sentinel, so the real command exit code is
 * observable even while the remote shell stays running.
 * @param viewport - settled scrollback delta for the send.
 * @returns the captured code, or `undefined` when no marker survived (e.g. the
 *   shell exited first, or the output bound dropped it).
 */
function parseRemoteExitCode(viewport: string): number | undefined {
  const lines = viewport.split(/\r?\n/)
  // The marker is the last wrapped command line before the sentinel; scan
  // backwards so a command's own echoed marker cannot shadow it.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /^__DSH_EXIT__=(\d+)$/.exec((lines[index] ?? '').trim())
    if (match !== null) return Number(match[1])
  }
  return undefined
}

/**
 * Register the remote host tools.
 * @param ctx - Cordis context carrying the required services.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:remote',
    order: 107,
    text: 'Create a remote connection with remote_open, passing a pasted JumpServer connect command or a remote_search result as hostRef. Run commands on it with remote_exec (reuse its sessionId for zero re-authentication) or the terminal tools. Track and close every session id; remote_close_all closes them all at once.',
  })

  ctx.tools.register(defineTool({
    name: 'remote_search',
    description: 'Find remote hosts matching a query across registered discovery providers (e.g. JumpServer connect targets, pass ssh entries). Returns non-secret metadata only.',
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text query; empty lists everything the providers advertise.' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            host: { type: 'string', required: true },
            port: { type: 'integer', required: true },
            username: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const specs = await ctx.remoteHosts.search(args.query)
      return specs.map(spec => ({
        name: spec.name,
        host: spec.host,
        port: spec.port,
        ...spec.username !== undefined ? { username: spec.username } : {},
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'remote_open',
    description: 'Create a persistent SSH connection to a remote host. Pass the pasted JumpServer connect command as hostRef (e.g. "ssh user#account#token@host -p port"), a configured host name from remote_search, or any reference a discovery provider resolves. The credential must be configured in the credentials store; if it is not, tell the user to store it. Returns a session id usable by terminal_send/terminal_read/terminal_signal/terminal_close.',
    parameters: {
      hostRef: { type: 'string', required: true, description: 'Host reference from a discovery provider.' },
      name: { type: 'string', description: 'Optional owner-local display name such as "prod-logs".' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', required: true },
          name: { type: 'string' },
          type: { type: 'string', required: true },
          pid: { type: 'integer' },
          status: { type: 'object', required: true, additionalProperties: false, properties: { kind: { type: 'string', required: true } } },
          motd: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `opened ${value.type} session ${value.sessionId}` }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec.agent)
      if (args.hostRef.length === 0) throw new Error('hostRef must be a non-empty string')
      const opened = await ctx.terminals.spawn(agent, {
        type: 'ssh',
        ...args.name !== undefined ? { name: args.name } : {},
        params: { hostRef: args.hostRef },
      }, exec.signal)
      // Resolve the spec so the known host can be recorded in the directory,
      // and learn the remote hostname from the session when possible.
      const spec = await ctx.remoteHosts.resolve(args.hostRef)
      const remoteName = await readRemoteHostname(ctx, agent, opened.sessionId, exec.signal)
      const known = remoteName !== undefined
        ? { ...spec, name: remoteName }
        : spec
      ctx.remoteHosts.remember(known, opened.sessionId)
      return opened
    },
    presentCall: args => ({
      card: 'terminal',
      title: `ssh ${args.hostRef}`,
      description: 'Open persistent remote SSH session',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'remote_exec',
    description: 'Run one bounded command on a remote host and return its output and real exit code. Pass sessionId from remote_open to reuse the open connection with zero re-authentication, or hostRef to open a temporary session that is closed after the command. Use remote_open then repeated remote_exec(sessionId) for multi-step work on one connection.',
    parameters: {
      hostRef: { type: 'string', description: 'Host reference from a discovery provider; required to open a temporary session when sessionId is omitted.' },
      sessionId: { type: 'string', description: 'Open connection from remote_open; when provided the command runs on that connection instead of opening a temporary session.' },
      command: { type: 'string', required: true, description: 'Remote shell command to execute.' },
      timeoutMs: { type: 'number', description: 'Send wait bound in milliseconds.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
          stdout: { type: 'string', required: true },
          waitReason: { type: 'string', required: true, enum: ['stdin_read', 'inferred_idle', 'timeout', 'session_exit'] },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: ['```console', value.stdout.replace(/\n+$/, ''), '```'].join('\n'),
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec.agent)
      if (args.command.trim().length === 0) throw new Error('command must be a non-empty string')
      const hasHostRef = args.hostRef !== undefined && args.hostRef.length > 0
      const hasSessionId = args.sessionId !== undefined && args.sessionId.length > 0
      if (hasHostRef === hasSessionId) {
        throw new Error('remote_exec requires exactly one of hostRef (new temporary session) or sessionId (existing connection from remote_open)')
      }

      // Wrap the command so its real exit code is observable before the
      // transport appends its readiness sentinel and settles the send.
      const wrapped = `${args.command.trim()}; echo __DSH_EXIT__=$?`

      let sessionId: TerminalSessionId
      let opened: TerminalSpawnResult | undefined
      if (hasSessionId) {
        // Reuse an open connection: it must be live and owned by this agent.
        const owned = ctx.terminals.list(agent).find(session => String(session.sessionId) === args.sessionId)
        if (owned === undefined) {
          throw new Error(`no live session "${args.sessionId}" owned by this agent; open one with remote_open first`)
        }
        sessionId = owned.sessionId
      } else {
        if (args.hostRef === undefined) throw new Error('hostRef must be a non-empty string')
        opened = await ctx.terminals.spawn(agent, {
          type: 'ssh',
          params: { hostRef: args.hostRef },
        }, exec.signal)
        sessionId = opened.sessionId
      }
      try {
        const send = ctx.terminals.startSend(agent, sessionId, {
          text: wrapped,
          submit: true,
          ...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {},
          signal: exec.signal,
        })
        const result = await send.done
        return {
          exitCode: parseRemoteExitCode(result.viewport)
            ?? (result.sessionStatus.kind === 'exited' ? result.sessionStatus.exitCode : null),
          stdout: result.viewport,
          waitReason: result.waitReason,
          truncated: result.truncated,
        }
      } finally {
        if (opened !== undefined) await ctx.terminals.kill(agent, opened.sessionId, 'remote_exec finished')
      }
    },
    presentCall: args => ({
      card: 'terminal',
      title: `ssh ${args.sessionId ?? args.hostRef} "${args.command}"`,
      description: 'Run one remote command',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'remote_close',
    description: 'Close a persistent remote SSH session and forget its host from the known-host dictionary. Use after remote_open work is done; the session id comes from remote_open.',
    parameters: {
      sessionId: { type: 'string', required: true, description: 'Terminal session id returned by remote_open.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          closed: { type: 'boolean', required: true },
          host: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.closed ? `closed session for ${value.host ?? 'unknown host'}` : 'session was not live' }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec.agent)
      if (args.sessionId.length === 0) throw new Error('sessionId must be a non-empty string')
      // Find and forget the host whose live session this is.
      const host = ctx.remoteHosts.hostForSession(args.sessionId)
      await ctx.terminals.kill(agent, args.sessionId as never, 'remote_close')
      if (host !== undefined) ctx.remoteHosts.forget(host)
      return { closed: true, ...host !== undefined ? { host } : {} }
    },
    presentCall: args => ({
      card: 'generic',
      title: `close remote session ${args.sessionId}`,
      description: 'Close and forget remote session',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'remote_close_all',
    description: 'Close every persistent remote (ssh) session opened by this agent and forget their hosts from the known-host dictionary. Use when the user asks to close, disconnect, or clean up all remote hosts.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          closed: { type: 'integer', required: true },
          hosts: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.closed === 0 ? 'no remote sessions were open' : `closed ${value.closed} remote session(s): ${value.hosts.join(', ')}` }],
    },
    async execute(_args, exec) {
      const agent = requireAgent(exec.agent)
      // Only ssh sessions are remote hosts; the persistent bash session and
      // any other backend stay untouched.
      const sessions = ctx.terminals.list(agent).filter(session => session.type === 'ssh')
      const hosts: string[] = []
      for (const session of sessions) {
        const host = ctx.remoteHosts.hostForSession(String(session.sessionId))
        if (host !== undefined) {
          hosts.push(host)
          ctx.remoteHosts.forget(host)
        }
        await ctx.terminals.kill(agent, session.sessionId, 'remote_close_all')
      }
      return { closed: sessions.length, hosts }
    },
    presentCall: () => ({
      card: 'generic',
      title: 'close all remote sessions',
      description: 'Close and forget every remote session',
    }),
  }))
}
