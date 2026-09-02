import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import RemoteHostDirectory, { type RemoteHostProvider, type RemoteHostSpec } from '../src/index.ts'

/** A spec fixture for a gateway host with a connect-token username. */
function spec(host: string, name = host): RemoteHostSpec {
  return {
    name,
    host,
    port: 22222,
    username: 'jeremy#readuser#token',
    tokenRef: credentialRef('JUMPSERVER_PASSWORD'),
  }
}

/** Boot a bare directory with no providers. */
async function boot(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(RemoteHostDirectory)
  return ctx
}

describe('remote-hosts directory lifecycle', () => {
  it('remember records a host for search and keeps the session association', async () => {
    const ctx = await boot()
    ctx.remoteHosts.remember(spec('172.16.6.100', 'gate.example.com'), 'pty-1')

    const results = await ctx.remoteHosts.search('')
    expect(results.map(s => s.name)).toEqual(['gate.example.com'])
    expect(ctx.remoteHosts.sessionFor('172.16.6.100')).toBe('pty-1')
    expect(ctx.remoteHosts.hostForSession('pty-1')).toBe('172.16.6.100')
  })

  it('remember without a session id records the host but no live session', async () => {
    const ctx = await boot()
    ctx.remoteHosts.remember(spec('172.16.6.100'))

    expect((await ctx.remoteHosts.search('')).map(s => s.name)).toEqual(['172.16.6.100'])
    expect(ctx.remoteHosts.sessionFor('172.16.6.100')).toBeUndefined()
    expect(ctx.remoteHosts.hostForSession('anything')).toBeUndefined()
  })

  it('a later remember for the same host replaces the record and the session (last connection wins)', async () => {
    const ctx = await boot()
    ctx.remoteHosts.remember(spec('172.16.6.100', 'old.example.com'), 'pty-1')
    ctx.remoteHosts.remember(spec('172.16.6.100', 'new.example.com'), 'pty-2')

    expect((await ctx.remoteHosts.search('')).map(s => s.name)).toEqual(['new.example.com'])
    expect(ctx.remoteHosts.sessionFor('172.16.6.100')).toBe('pty-2')
    expect(ctx.remoteHosts.hostForSession('pty-1')).toBeUndefined()
    expect(ctx.remoteHosts.hostForSession('pty-2')).toBe('172.16.6.100')
  })

  it('hostForSession disambiguates among several live hosts', async () => {
    const ctx = await boot()
    ctx.remoteHosts.remember(spec('172.16.6.100', 'gate.example.com'), 'pty-1')
    ctx.remoteHosts.remember(spec('10.0.0.5', 'db.internal'), 'pty-2')

    expect(ctx.remoteHosts.hostForSession('pty-1')).toBe('172.16.6.100')
    expect(ctx.remoteHosts.hostForSession('pty-2')).toBe('10.0.0.5')
    expect(ctx.remoteHosts.sessionFor('172.16.6.100')).toBe('pty-1')
    expect(ctx.remoteHosts.sessionFor('10.0.0.5')).toBe('pty-2')
  })

  it('forget removes the host from search and drops the session association', async () => {
    const ctx = await boot()
    ctx.remoteHosts.remember(spec('172.16.6.100', 'gate.example.com'), 'pty-1')
    ctx.remoteHosts.remember(spec('10.0.0.5', 'db.internal'), 'pty-2')

    ctx.remoteHosts.forget('172.16.6.100')

    expect((await ctx.remoteHosts.search('')).map(s => s.name)).toEqual(['db.internal'])
    expect(ctx.remoteHosts.sessionFor('172.16.6.100')).toBeUndefined()
    expect(ctx.remoteHosts.hostForSession('pty-1')).toBeUndefined()
    expect(ctx.remoteHosts.hostForSession('pty-2')).toBe('10.0.0.5')
  })

  it('forget is a no-op for an unknown host', async () => {
    const ctx = await boot()
    ctx.remoteHosts.remember(spec('172.16.6.100'), 'pty-1')

    ctx.remoteHosts.forget('10.0.0.5')

    expect((await ctx.remoteHosts.search('')).map(s => s.name)).toEqual(['172.16.6.100'])
    expect(ctx.remoteHosts.sessionFor('172.16.6.100')).toBe('pty-1')
  })

  it('forgetAll clears every known host and live session', async () => {
    const ctx = await boot()
    ctx.remoteHosts.remember(spec('172.16.6.100'), 'pty-1')
    ctx.remoteHosts.remember(spec('10.0.0.5'), 'pty-2')

    ctx.remoteHosts.forgetAll()

    expect(await ctx.remoteHosts.search('')).toEqual([])
    expect(ctx.remoteHosts.sessionFor('172.16.6.100')).toBeUndefined()
    expect(ctx.remoteHosts.hostForSession('pty-1')).toBeUndefined()
    expect(ctx.remoteHosts.hostForSession('pty-2')).toBeUndefined()
  })

  it('search lists known hosts before provider results and dedupes by name', async () => {
    const ctx = await boot()
    ctx.remoteHosts.remember(spec('172.16.6.100', 'gate.example.com'), 'pty-1')

    const provider: RemoteHostProvider = {
      id: 'fixture',
      matches: () => true,
      resolve: async () => spec('172.16.6.100', 'gate.example.com'),
      search: async () => [
        // Same name as the known host: deduped away.
        spec('172.16.6.100', 'gate.example.com'),
        // Distinct name: appears after the known host.
        spec('10.0.0.5', 'db.internal'),
      ],
    }
    ctx.remoteHosts.registerProvider(provider)

    const results = await ctx.remoteHosts.search('')
    expect(results.map(s => s.name)).toEqual(['gate.example.com', 'db.internal'])
  })
})
