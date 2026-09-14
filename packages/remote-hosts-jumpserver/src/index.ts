/**
 * JumpServer discovery provider for `ctx.remoteHosts`.
 *
 * This package owns one Service Provider role of the remote-host discovery
 * seam: it parses the SSH connect command the JumpServer web UI copies
 * (`ssh <user>#<account>#<connect-token>@<host> -p <port>` or the legacy
 * `JMS-<uuid>@<host>`) into a `RemoteHostSpec`. The username is the
 * connect-token-bearing part before `@`; the gateway host and port come from
 * the command itself, so no preset or settings configuration is required. The
 * ssh password still lives in the credentials store (`JUMPSERVER_PASSWORD`).
 *
 * @module @zealousw/dsh-remote-hosts-jumpserver
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { RemoteHostProvider, RemoteHostSpec } from '@zealousw/dsh-remote-hosts'

/** Plugin configuration. */
export interface Config {
  /** Default port when the connect command omits `-p` (default 22222). */
  port?: number
  /** CredentialRef name for the ssh password (default `JUMPSERVER_PASSWORD`). */
  tokenRef?: string
}

/** Schemastery config schema; fields are optional unless marked `required()`. */
export const Config: z<Config> = z.object({
  port: z.number(),
  tokenRef: z.string(),
})

/** Cordis plugin name. */
export const name = 'remote-hosts-jumpserver'
/** Required services: discovery directory and the credential seam. */
export const inject = ['remoteHosts', 'credentials']

/** A parsed SSH target: username, host, and port from a connect command. */
interface ParsedTarget {
  readonly username: string
  readonly host: string
  readonly port: number | undefined
}

/**
 * Parse a connect command or bare target into its parts.
 * Accepts:
 * - `ssh <user>#<account>#<token>@<host> -p <port>`
 * - `<user>#<account>#<token>@<host> -p <port>`
 * - `JMS-<uuid>@<host> -p <port>`
 * - bare `<user>#<account>#<token>@<host>` (port from config)
 * @param ref - the host reference or pasted connect command.
 * @returns the parsed username, host, and optional port.
 */
function parseTarget(ref: string): ParsedTarget | undefined {
  const trimmed = ref.trim()
  // Strip a leading `ssh ` prefix if the whole command was pasted.
  const body = /^ssh\s+/.test(trimmed) ? trimmed.replace(/^ssh\s+/, '') : trimmed
  // Split off a trailing `-p <port>` clause.
  let port: number | undefined
  let target = body
  const portMatch = /\s-p\s+(\d+)\s*$/.exec(body)
  if (portMatch !== null) {
    port = Number(portMatch[1])
    target = body.slice(0, portMatch.index)
  }
  const at = target.indexOf('@')
  if (at <= 0) return undefined
  const username = target.slice(0, at).trim()
  const host = target.slice(at + 1).trim()
  if (username.length === 0 || host.length === 0) return undefined
  return { username, host, port }
}

/**
 * Register the JumpServer discovery provider on `ctx.remoteHosts`.
 * @param ctx - Cordis context carrying the discovery directory and credentials.
 * @param config - plugin configuration (Schemastery-resolved).
 */
export function apply(ctx: Context, config: Config = {}): void {
  const defaultPort = config.port ?? 22222
  const tokenRef = credentialRef(config.tokenRef ?? 'JUMPSERVER_PASSWORD')

  const provider: RemoteHostProvider = {
    id: 'jumpserver',

    matches(ref: string): boolean {
      return parseTarget(ref) !== undefined
    },

    resolve(ref: string): Promise<RemoteHostSpec> {
      const parsed = parseTarget(ref)
      if (parsed === undefined) {
        return Promise.reject(new Error(
          `jumpserver: cannot parse "${ref}" as a connect command; expected "<user>#<account>#<token>@<host>[-p <port>]"`,
        ))
      }
      return Promise.resolve({
        name: ref.trim(),
        host: parsed.host,
        port: parsed.port ?? defaultPort,
        username: parsed.username,
        tokenRef,
      })
    },

    search(_query: string): Promise<RemoteHostSpec[]> {
      // No catalog: the connect command is the discovery unit the user already
      // has from the web UI.
      return Promise.resolve([])
    },
  }

  ctx.remoteHosts.registerProvider(provider)
}
