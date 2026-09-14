/**
 * File-backed discovery provider for `ctx.remoteHosts`: static test servers
 * listed in a YAML document (name, host, port, username, tokenRef) become
 * resolvable host references. Passwords never live in the document — each
 * entry's `tokenRef` names a credential in the credentials store, resolved by
 * the transport at the password prompt, so the model never sees a secret.
 *
 * @module @zealousw/dsh-remote-hosts-file
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { RemoteHostProvider, RemoteHostSpec } from '@zealousw/dsh-remote-hosts'

/** One static host entry from the document. */
export interface HostEntry {
  /** Model-visible display name; also the host reference (`remote_open(hostRef: name)`). */
  name: string
  /** SSH host or gateway address. */
  host: string
  /** SSH port. */
  port: number
  /** SSH username. */
  username?: string
  /** CredentialRef for the password, resolved by the transport at the prompt. */
  tokenRef: string
}

/** Plugin configuration. */
export interface Config {
  /** YAML document path (default `$DSH_HOME/remote-hosts.yaml`). */
  path?: string
}

/** Schemastery config schema. */
export const Config: z<Config> = z.object({
  path: z.string(),
})

/** Cordis plugin name. */
export const name = 'remote-hosts-file'
/** Required services: the discovery directory (credential resolution stays with the transport). */
export const inject = ['remoteHosts']

/** A bare host name is the only reference shape this provider resolves. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

/**
 * Parse the hosts document, validating every entry.
 * @param path - the document path.
 * @returns the validated entries; an absent file yields an empty list.
 * @throws with a loud message naming the path and the offending entry.
 */
async function loadHosts(path: string): Promise<HostEntry[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(`remote-hosts-file: cannot read ${path}: ${String(error)}`)
  }
  const doc = parseDocument(text)
  if (doc.errors.length > 0) {
    throw new Error(`remote-hosts-file: ${path} is not valid YAML: ${doc.errors[0]?.message ?? 'parse error'}`)
  }
  const root = doc.toJS() as { hosts?: unknown } | null
  const raw = root?.hosts
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    throw new Error(`remote-hosts-file: ${path} expects a top-level "hosts:" list`)
  }
  return raw.map((entry, index) => validateEntry(entry, index, path))
}

function validateEntry(entry: unknown, index: number, path: string): HostEntry {
  const source = `remote-hosts-file: entry #${index + 1} of ${path}`
  if (entry === null || typeof entry !== 'object') throw new Error(`${source} must be a mapping`)
  const e = entry as Record<string, unknown>
  const name = typeof e.name === 'string' ? e.name : undefined
  const host = typeof e.host === 'string' ? e.host : undefined
  const port = typeof e.port === 'number' ? e.port : undefined
  const username = typeof e.username === 'string' ? e.username : undefined
  const tokenRef = typeof e.tokenRef === 'string' ? e.tokenRef : undefined
  if (name === undefined || name.length === 0) throw new Error(`${source} requires a non-empty "name"`)
  if (host === undefined || host.length === 0) throw new Error(`${source} requires a non-empty "host"`)
  if (port === undefined || !Number.isSafeInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${source} requires "port" to be an integer between 1 and 65535`)
  }
  if (tokenRef === undefined || tokenRef.length === 0) {
    throw new Error(`${source} requires a "tokenRef" naming a credential in the credentials store`)
  }
  // Rejects a malformed reference name before it can reach the transport.
  credentialRef(tokenRef)
  return { name, host, port, ...username !== undefined ? { username } : {}, tokenRef }
}

/**
 * Register the file-backed discovery provider on `ctx.remoteHosts`.
 * @param ctx - Cordis context carrying the discovery directory.
 * @param config - plugin configuration (Schemastery-resolved).
 */
export function apply(ctx: Context, config: Config = {}): void {
  const path = config.path ?? join(resolveDshHome(), 'remote-hosts.yaml')

  const provider: RemoteHostProvider = {
    id: 'file',

    matches(ref: string): boolean {
      // Bare names only: connect commands and `user@host` references (spaces,
      // `@`, `ssh ` prefix) never reach the file lookup.
      return NAME_RE.test(ref.trim())
    },

    async resolve(ref: string): Promise<RemoteHostSpec> {
      const needle = ref.trim().toLowerCase()
      const hosts = await loadHosts(path)
      const entry = hosts.find(candidate => candidate.name.toLowerCase() === needle)
      if (entry === undefined) {
        throw new Error(
          `remote-hosts-file: no configured host named "${ref}" (checked ${path}); add it there or paste a connect command as hostRef`,
        )
      }
      return {
        name: entry.name,
        host: entry.host,
        port: entry.port,
        ...entry.username !== undefined ? { username: entry.username } : {},
        tokenRef: credentialRef(entry.tokenRef),
      }
    },

    async search(query: string): Promise<RemoteHostSpec[]> {
      const needle = query.trim().toLowerCase()
      const hosts = await loadHosts(path)
      return hosts
        .filter(candidate => needle.length === 0
          || candidate.name.toLowerCase().includes(needle)
          || candidate.host.toLowerCase().includes(needle)
          || (candidate.username ?? '').toLowerCase().includes(needle))
        .map(entry => ({
          name: entry.name,
          host: entry.host,
          port: entry.port,
          ...entry.username !== undefined ? { username: entry.username } : {},
          tokenRef: credentialRef(entry.tokenRef),
        }))
    },
  }

  ctx.remoteHosts.registerProvider(provider)
}
