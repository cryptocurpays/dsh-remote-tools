import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import RemoteHostDirectory, { type RemoteHostSpec } from '@zealousw/dsh-remote-hosts'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import type { TerminalBackend, TerminalBackendSession, TerminalReadRequest, TerminalReadResult, TerminalSendOperation, TerminalSendRead, TerminalSendRequest, TerminalSendResult, TerminalSessionStatus, TerminalSignal, TerminalSignalResult } from '@deepseek-ai/dsh-terminal'

import * as ToolRemote from '../src/index.ts'

const testSignal = new AbortController().signal

/** A send operation that resolves immediately to a fixed result. */
class StubSendOperation implements TerminalSendOperation {
  readonly done: Promise<TerminalSendResult>
  constructor(result: TerminalSendResult) {
    this.done = Promise.resolve(result)
  }
  readOutput(): TerminalSendRead {
    return { delta: '', truncated: false }
  }
  cancel(): boolean {
    return true
  }
}

/** A fake PTY session whose send text is recorded and result is scripted. */
class FakeSession implements TerminalBackendSession {
  motd = 'fake-motd'
  pid = 4242
  closed: string[] = []
  sent: string[] = []
  result: TerminalSendResult

  constructor(result?: TerminalSendResult) {
    this.result = result ?? {
      viewport: '',
      waitReason: 'stdin_read',
      sessionStatus: { kind: 'running' },
      truncated: false,
    }
  }

  startSend(request: TerminalSendRequest): TerminalSendOperation {
    this.sent.push(request.text)
    return new StubSendOperation(this.result)
  }
  read(_request: TerminalReadRequest): TerminalReadResult {
    throw new Error('FakeSession: no reads in this test')
  }
  signal(_signal: TerminalSignal): Promise<TerminalSignalResult> {
    throw new Error('FakeSession: no signals in this test')
  }
  status(): TerminalSessionStatus {
    return { kind: 'running' }
  }
  close(reason: string): Promise<void> {
    this.closed.push(reason)
    return Promise.resolve()
  }
}

function spec(host: string, name: string): RemoteHostSpec {
  return { name, host, port: 22222, username: 'jeremy#readuser#token', tokenRef: credentialRef('JUMPSERVER_PASSWORD') }
}

async function liveAgent(ctx: Context, id = 'parent-1'): Promise<Agent> {
  const session = Session.create(SessionId(id))
  const scope = ctx.plugin(() => {})
  const agent = { id: SessionId(id), options: {}, session, status: 'idle', ctx: scope.ctx } as Agent
  ctx.agents.register(agent)
  return agent
}

async function boot(results: TerminalSendResult[] = []): Promise<{ ctx: Context; agent: Agent; ssh: FakeSession[] }> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(RemoteHostDirectory)
  await ctx.plugin(TerminalSessionService)

  const ssh: FakeSession[] = []
  const backend: TerminalBackend = {
    type: 'ssh',
    async spawn() {
      const session = new FakeSession(results.shift())
      ssh.push(session)
      return session
    },
  }
  ctx.terminals.registerBackend(backend)
  ToolRemote.apply(ctx)

  const agent = await liveAgent(ctx)
  return { ctx, agent, ssh }
}

function execute(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({ signal: testSignal, callId: ToolCallId(`exec-${name}`), name, arguments: args, agent })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-tool-remote remote_exec', () => {
  it('exposes sessionId as an alternative to hostRef and keeps command required', async () => {
    const { ctx } = await boot()
    const schema = ctx.tools.schemas().find(s => s.name === 'remote_exec')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['command', 'hostRef', 'sessionId', 'timeoutMs'])
    expect(props.command).toMatchObject({ type: 'string' })
    const required = (schema!.parameters as { required?: string[] }).required ?? []
    expect(required).toContain('command')
    expect(required).not.toContain('hostRef')
    expect(required).not.toContain('sessionId')
  })

  it('reuses an open connection (sessionId), wraps the command for exit capture, and does not close it', async () => {
    const { ctx, agent, ssh } = await boot()
    const opened = await ctx.terminals.spawn(agent, { type: 'ssh' })
    ctx.remoteHosts.remember(spec('172.16.6.100', 'gate.example.com'), String(opened.sessionId))
    ssh[0]!.result = {
      viewport: 'file1\nfile2\n__DSH_EXIT__=3\n__DSH_READY__',
      waitReason: 'stdin_read',
      sessionStatus: { kind: 'running' },
      truncated: false,
    }

    const result = await execute(ctx, agent, 'remote_exec', { sessionId: String(opened.sessionId), command: 'ls' })
    expect(result.isError).toBe(false)
    const value = result.value as { exitCode: number | null; stdout: string; waitReason: string }
    expect(value.exitCode).toBe(3)
    expect(value.waitReason).toBe('stdin_read')
    expect(ssh[0]!.sent).toEqual(['ls; echo __DSH_EXIT__=$?'])
    expect(ssh[0]!.closed).toEqual([]) // reused connection stays open
    expect(ctx.remoteHosts.sessionFor('172.16.6.100')).toBe(String(opened.sessionId))
  })

  it('opens a temporary session for hostRef, wraps the command, and closes it afterwards', async () => {
    const { ctx, agent, ssh } = await boot([{
      viewport: 'root\n__DSH_EXIT__=0\n__DSH_READY__',
      waitReason: 'stdin_read',
      sessionStatus: { kind: 'running' },
      truncated: false,
    }])

    const result = await execute(ctx, agent, 'remote_exec', { hostRef: 'ssh user#acct#token@172.16.6.100 -p 22222', command: 'whoami' })
    expect(result.isError).toBe(false)
    expect((result.value as { exitCode: number }).exitCode).toBe(0)
    expect(ssh[0]!.sent).toEqual(['whoami; echo __DSH_EXIT__=$?'])
    expect(ssh[0]!.closed).toEqual(['remote_exec finished'])
  })

  it('falls back to the session exit status when no marker survived, and to null while running', async () => {
    const { ctx, agent, ssh } = await boot([{
      viewport: 'no marker here',
      waitReason: 'timeout',
      sessionStatus: { kind: 'running' },
      truncated: false,
    }])
    // Reused connection path: the first spawn consumes the queued result,
    // which is then overwritten with the session-exit case.
    const opened = await ctx.terminals.spawn(agent, { type: 'ssh' })
    ssh[0]!.result = {
      viewport: 'connection closed',
      waitReason: 'session_exit',
      sessionStatus: { kind: 'exited', exitCode: 42, signal: null },
      truncated: false,
    }
    const exited = await execute(ctx, agent, 'remote_exec', { sessionId: String(opened.sessionId), command: 'exit 42' })
    expect(exited.isError).toBe(false)
    expect((exited.value as { exitCode: number | null }).exitCode).toBe(42)

    // Temporary path: the spawned session consumes the queued running result.
    const running = await execute(ctx, agent, 'remote_exec', { hostRef: 'x@y', command: 'sleep 5' })
    expect(running.isError).toBe(false)
    expect((running.value as { exitCode: number | null }).exitCode).toBeNull()
  })

  it('rejects ambiguous or dangling target references', async () => {
    const { ctx, agent } = await boot()
    const both = await execute(ctx, agent, 'remote_exec', { hostRef: 'x@y', sessionId: 'pty-1', command: 'ls' })
    expect(both.isError).toBe(true)
    expect(text(both)).toMatch(/exactly one of hostRef/)

    const neither = await execute(ctx, agent, 'remote_exec', { command: 'ls' })
    expect(neither.isError).toBe(true)
    expect(text(neither)).toMatch(/exactly one of hostRef/)

    const dangling = await execute(ctx, agent, 'remote_exec', { sessionId: 'pty-99', command: 'ls' })
    expect(dangling.isError).toBe(true)
    expect(text(dangling)).toMatch(/no live session "pty-99" owned by this agent/)
  })

  it('renders the console-fenced stdout', async () => {
    const { ctx, agent } = await boot([{
      viewport: 'ok\n__DSH_EXIT__=0\n__DSH_READY__',
      waitReason: 'stdin_read',
      sessionStatus: { kind: 'running' },
      truncated: false,
    }])
    const result = await execute(ctx, agent, 'remote_exec', { hostRef: 'x@y', command: 'echo ok' })
    expect(text(result)).toContain('```console')
    expect(text(result)).toContain('ok')
  })
})
