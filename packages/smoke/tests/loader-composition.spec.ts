/**
 * Real Loader composition smoke: mounts this bundle's five plugins through the
 * Cordis Loader exactly as a deployed `dsh` would (cordis.patch.yml rows +
 * name resolution), then drives one real `remote_search` through ctx.tools.
 *
 * Scope boundary: this mounts the real service registries (tools, terminals,
 * subprocess, credentials) but does NOT spawn an ssh session — remote_open /
 * remote_exec need a reachable host AND the terminal `params` patch applied to
 * the running dsh (patches/terminal-params.patch); both are covered by the
 * package tests and the patch documentation, not here.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import { MemoryCredentials } from '../../remote-hosts-jumpserver/tests/memory.ts'

import RemoteHostDirectory from '@zealousw/dsh-remote-hosts'
import * as Jumpserver from '@zealousw/dsh-remote-hosts-jumpserver'
import * as FileProvider from '@zealousw/dsh-remote-hosts-file'
import * as TerminalSsh from '@zealousw/dsh-terminal-ssh'
import * as ToolRemote from '@zealousw/dsh-tool-remote'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('dsh-remote-tools real Loader composition', () => {
  it('boots the five plugins through cordis.yml and runs a real remote_search', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-remote-tools-loader-'))
    const emptyHosts = join(root, 'remote-hosts.yaml')
    await writeFile(emptyHosts, 'hosts: []\n')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      // Required service registries (as a shipped profile would supply).
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-terminal'",
      "- name: '@deepseek-ai/dsh-subprocess'",
      "- name: '@deepseek-ai/dsh-credentials'",
      // The bundle's own overlay rows (cordis.patch.yml).
      "- name: '@zealousw/dsh-remote-hosts'",
      "- name: '@zealousw/dsh-remote-hosts-jumpserver'",
      "- name: '@zealousw/dsh-remote-hosts-file'",
      `  config:`,
      `    path: ${JSON.stringify(emptyHosts)}`,
      "- name: '@zealousw/dsh-terminal-ssh'",
      "- name: '@zealousw/dsh-tool-remote'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-terminal', TerminalSessionService],
      ['@deepseek-ai/dsh-subprocess', SubprocessRuntime],
      ['@deepseek-ai/dsh-credentials', MemoryCredentials],
      ['@zealousw/dsh-remote-hosts', RemoteHostDirectory],
      ['@zealousw/dsh-remote-hosts-jumpserver', Jumpserver],
      ['@zealousw/dsh-remote-hosts-file', FileProvider],
      ['@zealousw/dsh-terminal-ssh', TerminalSsh],
      ['@zealousw/dsh-tool-remote', ToolRemote],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    // Every plugin loaded: the discovery directory and both providers are live.
    expect(context.remoteHosts).toBeDefined()
    expect(context.remoteHosts.listProviders().sort()).toEqual(['file', 'jumpserver'])

    // One real discovery call through the tool registry.
    const result = await context.tools.execute({
      signal: new AbortController().signal,
      callId: 'smoke-remote-search' as never,
      name: 'remote_search',
      arguments: { query: '' },
    })
    expect((result as { value: unknown }).value).toEqual([])
  })
})
