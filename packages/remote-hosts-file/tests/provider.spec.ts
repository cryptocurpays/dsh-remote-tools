import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import RemoteHostDirectory from '@cryptocurpays/dsh-remote-hosts'
import * as FileProvider from '../src/index.ts'

const HOSTS_YAML = `hosts:
  - name: test01
    host: 10.0.20.214
    port: 36626
    username: root
    tokenRef: TEST01_SSH_PASSWORD
  - name: test02
    host: 10.0.20.215
    port: 36626
    username: root
    tokenRef: TEST02_SSH_PASSWORD
`

/** Boot the discovery directory with the file provider over one document. */
async function boot(path: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(RemoteHostDirectory)
  FileProvider.apply(ctx, { path })
  return ctx
}

describe('remote-hosts-file', () => {
  let dir: string
  let path: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'remote-hosts-file-'))
    path = join(dir, 'hosts.yml')
    writeFileSync(path, HOSTS_YAML)
  })
  afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

  it('lists configured hosts as non-secret specs', async () => {
    const ctx = await boot(path)
    const results = await ctx.remoteHosts.search('test')
    expect(results.map(s => s.name).sort()).toEqual(['test01', 'test02'])
    const first = results[0]!
    expect(first).toMatchObject({ host: '10.0.20.214', port: 36626, username: 'root' })
    expect(String(first.tokenRef)).toBe('TEST01_SSH_PASSWORD')
  })

  it('resolves a host name to its spec, case-insensitively', async () => {
    const ctx = await boot(path)
    const spec = await ctx.remoteHosts.resolve('TEST01')
    expect(spec).toMatchObject({ name: 'test01', host: '10.0.20.214', port: 36626, username: 'root' })
    expect(String(spec.tokenRef)).toBe('TEST01_SSH_PASSWORD')
  })

  it('matches bare names but never connect commands or user@host references', async () => {
    const ctx = await boot(path)
    // A pasted connect command must not fall into the file lookup: without the
    // jumpserver provider mounted it must surface as NO_PROVIDER, not a file miss.
    await expect(ctx.remoteHosts.resolve('ssh jeremy#acct#tok@host -p 22222')).rejects.toThrow(/no remote host provider/)
    await expect(ctx.remoteHosts.resolve('user@10.0.20.214')).rejects.toThrow(/no remote host provider/)
  })

  it('rejects an unknown name with a loud message', async () => {
    const ctx = await boot(path)
    await expect(ctx.remoteHosts.resolve('missing-host')).rejects.toThrow(/no configured host named "missing-host"/)
  })

  it('returns no entries and rejects unknown names when the file is absent', async () => {
    const ctx = await boot(join(dir, 'absent.yml'))
    expect(await ctx.remoteHosts.search('')).toEqual([])
    await expect(ctx.remoteHosts.resolve('x')).rejects.toThrow(/no configured host named "x"/)
  })

  it('fails loud on an invalid YAML document', async () => {
    const bad = join(dir, 'bad.yml')
    writeFileSync(bad, 'hosts: [broken')
    const ctx = await boot(bad)
    await expect(ctx.remoteHosts.search('')).rejects.toThrow(/not valid YAML/)
  })

  it('fails loud on an entry missing its tokenRef', async () => {
    const bad = join(dir, 'notoken.yml')
    writeFileSync(bad, 'hosts:\n  - name: x\n    host: 1.2.3.4\n    port: 22\n')
    const ctx = await boot(bad)
    await expect(ctx.remoteHosts.search('')).rejects.toThrow(/requires a "tokenRef"/)
  })
})
