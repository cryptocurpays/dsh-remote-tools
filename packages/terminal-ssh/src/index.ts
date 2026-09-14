/**
 * Generic SSH terminal backend for the DeepSeek Harness terminal seam.
 * This package owns the Service Provider role for the `ssh` backend type of
 * the existing `ctx.terminals` capability: `spawn` resolves a host reference
 * through `ctx.remoteHosts`, resolves the access token through
 * `ctx.credentials`, and spawns the system `ssh` through
 * `ctx.subprocess.spawnTerminal`.
 *
 * @module @cryptocurpays/dsh-terminal-ssh
 */

import type { Context } from '@deepseek-ai/cordis'
import type { TerminalBackend, TerminalBackendSpawnSpec } from '@deepseek-ai/dsh-terminal'
import type {} from '@cryptocurpays/dsh-remote-hosts'
import { type Config, Config as ConfigSchema, validateConfig } from './config.ts'
import { SshPtySession } from './session.ts'

/** Schemastery config schema exposed for plugin defaulting. */
export { ConfigSchema as Config }

/** Cordis plugin name. */
export const name = 'terminal-ssh'
/** Required services: PTY registry, process substrate, credential seam, and discovery seam. */
export const inject = ['terminals', 'subprocess', 'credentials', 'remoteHosts']

/**
 * Register the `ssh` backend on `ctx.terminals`.
 * @param ctx - Cordis context carrying the required services.
 * @param config - plugin configuration (Schemastery-resolved).
 */
export function apply(ctx: Context, config: Config = {}): void {
  validateConfig(config)
  const resolved = config

  const backend: TerminalBackend = {
    type: resolved.backendType,

    async spawn(spec: TerminalBackendSpawnSpec) {
      const hostRef = spec.params?.hostRef
      if (hostRef === undefined || hostRef.length === 0) {
        throw new Error('terminal-ssh: params.hostRef is required (set it via remote_open)')
      }
      // Discovery seam: reference -> spec. Never expose the secret to the model.
      const target = await ctx.remoteHosts.resolve(hostRef)
      if (target.username === undefined) {
        const err = new Error(`terminal-ssh: host "${target.name}" has no username; use the "JMS-<uuid>@<preset>" form`)
        ;(err as { code?: string }).code = 'NEED_USERNAME'
        throw err
      }
      // Resolve the secret per operation — never cache across operations.
      const credential = await ctx.credentials.resolve(target.tokenRef)
      if (credential === undefined) {
        const err = new Error(`terminal-ssh: credential ${target.tokenRef} is not configured`)
        ;(err as { code?: string }).code = 'NEED_CREDENTIAL'
        throw err
      }
      const knownHosts = resolved.knownHostsPath.length > 0
        ? ['-o', `UserKnownHostsFile=${resolved.knownHostsPath}`]
        : []
      const argv = [
        resolved.sshPath,
        '-o', 'StrictHostKeyChecking=accept-new',
        ...knownHosts,
        '-p', String(target.port),
        `${target.username}@${target.host}`,
      ]
      const terminal = await ctx.subprocess.spawnTerminal({
        argv,
        cwd: spec.cwd ?? process.cwd(),
        rows: resolved.rows,
        cols: resolved.cols,
        graceMs: resolved.disposeGraceMs,
        ...spec.signal !== undefined ? { signal: spec.signal } : {},
      })
      const session = new SshPtySession(terminal, resolved, credential.value)
      await session.initialize(spec.signal)
      return session
    },
  }

  ctx.terminals.registerBackend(backend)
}
