/** Validated configuration for the generic SSH PTY backend. */

import z from '@deepseek-ai/schemastery'

/** Public plugin configuration. */
export interface Config {
  /** Backend registry type (default: `ssh`). */
  backendType?: string
  /** SSH executable (default: `ssh`). */
  sshPath?: string
  /** Plugin-managed known_hosts file; empty disables the override. */
  knownHostsPath?: string
  /** CredentialRef name for the ssh password (default: `JUMPSERVER_PASSWORD`). */
  tokenRef?: string
  /** Absolute send wait bound in milliseconds. */
  timeoutMs?: number
  /** Terminal rows. */
  rows?: number
  /** Terminal columns. */
  cols?: number
  /** Maximum retained logical lines. */
  scrollbackLines?: number
  /** Maximum retained UTF-8 bytes. */
  scrollbackMaxBytes?: number
  /** Maximum bytes returned by one read or settled viewport. */
  maxReadBytes?: number
  /** Grace before teardown escalates to `SIGKILL`. */
  disposeGraceMs?: number
}

/** Configuration after Schemastery defaults. */
export type ResolvedConfig = Required<Config>

/* jscpd:ignore-start -- parallel schemastery defaults with packages/terminal/terminal-bash/src/config.ts (same keys, ssh-flavored). */
/** Schemastery config exposed by the plugin. */
export const Config: z<Config> = z.object({
  backendType: z.string().default('ssh'),
  sshPath: z.string().default('ssh'),
  knownHostsPath: z.string().default(''),
  tokenRef: z.string().default('JUMPSERVER_PASSWORD'),
  timeoutMs: z.number().default(30_000),
  rows: z.number().default(40),
  cols: z.number().default(160),
  scrollbackLines: z.number().default(10_000),
  scrollbackMaxBytes: z.number().default(4 * 1024 * 1024),
  maxReadBytes: z.number().default(256 * 1024),
  disposeGraceMs: z.number().default(3_000),
})
/* jscpd:ignore-end */

/**
 * Assert every numeric config field is a positive safe integer and bounds compose.
 * @param config - Schemastery-resolved plugin configuration.
 * @returns Narrows the input to the fully resolved configuration.
 */
export function validateConfig(config: Config): asserts config is ResolvedConfig {
  const resolved = config as ResolvedConfig
  if (resolved.backendType.length === 0) throw new Error('terminal-ssh: backendType must be non-empty')
  if (resolved.sshPath.length === 0) throw new Error('terminal-ssh: sshPath must be non-empty')
  if (resolved.tokenRef.length === 0) throw new Error('terminal-ssh: tokenRef must be non-empty')
  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`terminal-ssh: ${name} must be a positive safe integer`)
    }
  }
  if (resolved.maxReadBytes > resolved.scrollbackMaxBytes) {
    throw new Error('terminal-ssh: maxReadBytes must not exceed scrollbackMaxBytes')
  }
}
