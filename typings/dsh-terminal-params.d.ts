/**
 * Dev-time type augmentation mirroring the upstream terminal `params`
 * extension (see patches/terminal-params.patch). It lets this bundle
 * typecheck against an UNPATCHED dsh-terminal. Remove this file once the
 * upstream PR is merged and the bundle builds against the released types.
 */
declare module '@deepseek-ai/dsh-terminal' {
  interface TerminalSpawnRequest {
    /**
     * Optional backend-owned parameters. Generic consumers and backends
     * ignore this; a backend that understands a key (e.g. `hostRef`) reads it.
     */
    params?: Record<string, string>
  }
}

export {}
