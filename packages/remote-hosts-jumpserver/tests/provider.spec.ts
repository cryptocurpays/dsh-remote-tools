import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemoryCredentials } from './memory.ts'
import RemoteHostDirectory from '@zealousw/dsh-remote-hosts'
import * as JumpserverProvider from '../src/index.ts'

/** Boot discovery + credentials + jumpserver provider. */
async function boot(config: JumpserverProvider.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials, { JUMPSERVER_PASSWORD: 'token-value' })
  await ctx.plugin(RemoteHostDirectory)
  JumpserverProvider.apply(ctx, config)
  return ctx
}

describe('remote-hosts-jumpserver', () => {
  it('parses a full pasted connect command', async () => {
    const ctx = await boot()
    const ref = 'ssh jeremy#readuser#00000000-0000-4000-8000-000000000001@172.16.6.100 -p 22222'
    const spec = await ctx.remoteHosts.resolve(ref)
    expect(spec).toMatchObject({
      host: '172.16.6.100',
      port: 22222,
      username: 'jeremy#readuser#00000000-0000-4000-8000-000000000001',
    })
    expect(String(spec.tokenRef)).toBe('JUMPSERVER_PASSWORD')
  })

  it('parses a bare target without the ssh prefix or port', async () => {
    const ctx = await boot({ port: 22222 })
    const spec = await ctx.remoteHosts.resolve('jeremy#readuser#token@172.16.6.100')
    expect(spec).toMatchObject({ host: '172.16.6.100', port: 22222, username: 'jeremy#readuser#token' })
  })

  it('parses a legacy JMS connect command', async () => {
    const ctx = await boot()
    const spec = await ctx.remoteHosts.resolve('ssh JMS-abc@172.16.6.100 -p 22222')
    expect(spec).toMatchObject({ host: '172.16.6.100', port: 22222, username: 'JMS-abc' })
  })

  it('does not match a target that is not a connect command', async () => {
    const ctx = await boot()
    await expect(ctx.remoteHosts.resolve('not-a-command')).rejects.toThrow(
      'no remote host provider can resolve "not-a-command"',
    )
  })

  it('rejects an unknown reference with NO_PROVIDER from the directory', async () => {
    const ctx = await boot()
    await expect(ctx.remoteHosts.resolve('plain-name')).rejects.toThrow('no remote host provider can resolve "plain-name"')
  })

  it('search returns no catalog entries until a connection is remembered', async () => {
    const ctx = await boot()
    expect(await ctx.remoteHosts.search('anything')).toEqual([])

    // Simulate a successful connection recording its remote hostname.
    const spec = await ctx.remoteHosts.resolve('ssh jeremy#readuser#token@172.16.6.100 -p 22222')
    ctx.remoteHosts.remember({ ...spec, name: 'new-gate-game.example.com' })

    const results = await ctx.remoteHosts.search('')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ name: 'new-gate-game.example.com', host: '172.16.6.100' })
    expect((await ctx.remoteHosts.search('gate-game')).map(s => s.name)).toEqual(['new-gate-game.example.com'])
  })
})
