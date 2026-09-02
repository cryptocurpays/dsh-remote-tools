/**
 * Dev-time type augmentation mirroring the terminal `params` extension
 * (patches/terminal-params.patch), which this bundle must apply to the
 * installed dsh-terminal because upstream does not accept external pull
 * requests while pre-release (see docs/terminal-params-patch.md). Lets the
 * bundle typecheck against an UNPATCHED dsh-terminal; keep it alongside the
 * patch until upstream ships the extension itself.
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
