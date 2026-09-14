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
import type { TerminalBackend, TerminalBackendSession, TerminalReadRequest, TerminalReadResult, TerminalSendOperation, TerminalSendRequest, TerminalSessionStatus, TerminalSignal, TerminalSignalResult } from '@deepseek-ai/dsh-terminal'

import * as ToolRemote from '../src/index.ts'

const testSignal = new AbortController().signal

/** A fake PTY session that records every close call; sends/reads are unreachable here. */
class FakeSession implements TerminalBackendSession {
  motd = 'fake-motd'
  pid = 4242
  closed: string[] = []
  startSend(_request: TerminalSendRequest): TerminalSendOperation {
    throw new Error('FakeSession: no sends in this test')
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

/** A parent Agent backed by a real Session and registered as live. */
async function liveAgent(ctx: Context, id = 'parent-1'): Promise<Agent> {
  const session = Session.create(SessionId(id))
  const scope = ctx.plugin(() => {})
  const agent = { id: SessionId(id), options: {}, session, status: 'idle', ctx: scope.ctx } as Agent
  ctx.agents.register(agent)
  return agent
}

async function boot(): Promise<{ ctx: Context; agent: Agent; ssh: FakeSession[]; bash: FakeSession[] }> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(RemoteHostDirectory)
  await ctx.plugin(TerminalSessionService)

  const ssh: FakeSession[] = []
  const bash: FakeSession[] = []
  const makeBackend = (type: string, store: FakeSession[]): TerminalBackend => ({
    type,
    async spawn() {
      const session = new FakeSession()
      store.push(session)
      return session
    },
  })
  ctx.terminals.registerBackend(makeBackend('ssh', ssh))
  ctx.terminals.registerBackend(makeBackend('bash', bash))
  ToolRemote.apply(ctx)

  const agent = await liveAgent(ctx)
  return { ctx, agent, ssh, bash }
}

describe('dsh-tool-remote remote_close_all', () => {
  it('registers a remote_close_all tool with an empty parameters schema', async () => {
    const { ctx } = await boot()
    const schema = ctx.tools.schemas().find(s => s.name === 'remote_close_all')
    expect(schema).toBeDefined()
    expect((schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}).toEqual({})
  })

  it('closes every owned ssh session, forgets their hosts, and leaves non-ssh sessions alone', async () => {
    const { ctx, agent, ssh, bash } = await boot()

    const ssh1 = await ctx.terminals.spawn(agent, { type: 'ssh' })
    const ssh2 = await ctx.terminals.spawn(agent, { type: 'ssh' })
    const bashSession = await ctx.terminals.spawn(agent, { type: 'bash' })
    ctx.remoteHosts.remember(spec('172.16.6.100', 'gate.example.com'), String(ssh1.sessionId))
    ctx.remoteHosts.remember(spec('10.0.0.5', 'db.internal'), String(ssh2.sessionId))

    const result = await ctx.tools.execute({
      signal: testSignal,
      callId: ToolCallId('remote-close-all-1'),
      name: 'remote_close_all',
      arguments: {},
      agent,
    })
    expect(result.isError).toBe(false)
    const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('')
    expect(text).toBe('closed 2 remote session(s): 172.16.6.100, 10.0.0.5')

    // Both ssh sessions closed with the tool's reason; the bash session untouched.
    expect(ssh[0]!.closed).toEqual(['remote_close_all'])
    expect(ssh[1]!.closed).toEqual(['remote_close_all'])
    expect(bash[0]!.closed).toEqual([])
    expect(ctx.terminals.list(agent).map(s => s.type)).toEqual(['bash'])

    // Known-host dictionary emptied and session associations dropped.
    expect(await ctx.remoteHosts.search('')).toEqual([])
    expect(ctx.remoteHosts.hostForSession(String(ssh1.sessionId))).toBeUndefined()
    expect(ctx.remoteHosts.sessionFor('172.16.6.100')).toBeUndefined()
    expect(bashSession.type).toBe('bash')
  })

  it('reports an empty close when no remote sessions are open', async () => {
    const { ctx, agent } = await boot()
    const result = await ctx.tools.execute({
      signal: testSignal,
      callId: ToolCallId('remote-close-all-2'),
      name: 'remote_close_all',
      arguments: {},
      agent,
    })
    expect(result.isError).toBe(false)
    const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('')
    expect(text).toBe('no remote sessions were open')
  })
})
