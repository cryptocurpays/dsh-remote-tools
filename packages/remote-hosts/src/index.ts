/**
 * Remote host discovery seam (`ctx.remoteHosts`).
 *
 * This package owns the Service Definition role of the remote-host discovery
 * capability: it merges provider registrations, resolves a host reference to
 * a connection spec, and exposes non-secret metadata for discovery. Concrete
 * providers such as a JumpServer connect-command parser or a pass-store
 * lookup decide where host references come from; this service only routes.
 *
 * @module @cryptocurpays/dsh-remote-hosts
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** One resolved remote host: non-secret connection facts plus a credential ref. */
export interface RemoteHostSpec {
  /** Human-readable display name (the resolved host reference, or the remote hostname once known). */
  readonly name: string
  /** SSH host or gateway address. */
  readonly host: string
  /** SSH port. */
  readonly port: number
  /**
   * SSH username (may be a connect token such as `JMS-<uuid>`). Absent for
   * gateway presets whose username is supplied per connection via the host
   * reference; a transport backend must reject a spawn without one.
   */
  readonly username?: string
  /** Credential reference for the password/token. */
  readonly tokenRef: CredentialRef
}

/** One named resolution strategy. */
export interface RemoteHostProvider {
  /** Stable provider id. */
  readonly id: string
  /** True if this provider can resolve the reference. */
  matches(ref: string): boolean
  /** Resolve to a spec; reject loudly when the entry is ambiguous or missing. */
  resolve(ref: string): Promise<RemoteHostSpec>
  /** List matching non-secret metadata. */
  search(query: string): Promise<RemoteHostSpec[]>
}

/** Machine-routable discovery failures. */
export type RemoteHostErrorCode = 'DUPLICATE_PROVIDER' | 'NO_PROVIDER'

/** Error carrying a stable {@link RemoteHostErrorCode}. */
export class RemoteHostError extends Error {
  constructor(message: string, readonly code: RemoteHostErrorCode) {
    super(message)
    this.name = 'RemoteHostError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Discovery registry for remote host references. */
    remoteHosts: RemoteHostDirectory
  }
}

/**
 * In-process registry for replaceable remote-host discovery providers.
 * Providers are consulted in registration order; a registration is
 * effect-bound so HMR/disposal removes exactly its contribution.
 */
export class RemoteHostDirectory extends Service {
  private readonly providers = new Map<string, RemoteHostProvider>()
  /** Known hosts recorded after a successful connection, keyed by host. */
  private readonly known = new Map<string, RemoteHostSpec>()
  /** Live session id associated with a known host, keyed by host. */
  private readonly liveSessions = new Map<string, string>()

  constructor(ctx: Context) {
    super(ctx, 'remoteHosts')
  }

  /**
   * Record a host that a consumer successfully connected to, so discovery
   * (`search`) lists it afterwards. A later record for the same host replaces
   * the earlier one (last connection wins).
   * @param spec - the resolved spec whose connection succeeded.
   * @param sessionId - optional live session id to associate with the host.
   */
  remember(spec: RemoteHostSpec, sessionId?: string): void {
    this.known.set(spec.host, spec)
    if (sessionId !== undefined) this.liveSessions.set(spec.host, sessionId)
  }

  /**
   * Remove one host from the known-host dictionary (e.g. when its session closes).
   * @param host - the gateway host to forget.
   */
  forget(host: string): void {
    this.known.delete(host)
    this.liveSessions.delete(host)
  }

  /**
   * Forget every recorded known host (e.g. on logout).
   */
  forgetAll(): void {
    this.known.clear()
    this.liveSessions.clear()
  }

  /**
   * Look up the live session id associated with a known host, if any.
   * @param host - the gateway host.
   * @returns the associated session id, or `undefined` when the host is unknown or not live.
   */
  sessionFor(host: string): string | undefined {
    return this.liveSessions.get(host)
  }

  /**
   * Find the host whose live session matches a session id.
   * @param sessionId - the session id to match.
   * @returns the host, or `undefined` when no known host holds that session.
   */
  hostForSession(sessionId: string): string | undefined {
    for (const [host, id] of this.liveSessions) {
      if (id === sessionId) return host
    }
    return undefined
  }

  /**
   * Register one discovery provider for this effect scope.
   * @param provider - provider with a non-empty unique id.
   * @returns disposer that removes exactly this contribution.
   */
  registerProvider(provider: RemoteHostProvider): () => void {
    if (provider.id.length === 0) throw new Error('remote host provider id must be non-empty')
    if (this.providers.has(provider.id)) {
      throw new RemoteHostError(`a remote host provider named "${provider.id}" is already registered`, 'DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(() => {
      this.providers.set(provider.id, provider)
      return () => {
        if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
      }
    }, 'remoteHosts.registerProvider()')
    return () => void dispose()
  }

  /**
   * List registered provider ids in registration order.
   * @returns fresh provider id list.
   */
  listProviders(): string[] {
    return [...this.providers.keys()]
  }

  /**
   * Resolve one host reference to a connection spec.
   * @param ref - provider-specific host reference (e.g. `JMS-...@host`, `pass:ssh/<name>`).
   * @returns the resolved spec.
   * @throws {@link RemoteHostError} with `NO_PROVIDER` when no provider matches,
   *   or the matching provider's own rejection for an unresolvable entry.
   */
  async resolve(ref: string): Promise<RemoteHostSpec> {
    for (const provider of this.providers.values()) {
      if (provider.matches(ref)) return provider.resolve(ref)
    }
    throw new RemoteHostError(`no remote host provider can resolve "${ref}"`, 'NO_PROVIDER')
  }

  /**
   * List non-secret metadata for host references matching a query.
   * @param query - free-text query; providers decide the match semantics.
   * @returns merged specs, deduplicated by name, in provider order.
   */
  async search(query: string): Promise<RemoteHostSpec[]> {
    const seen = new Set<string>()
    const results: RemoteHostSpec[] = []
    // Known hosts recorded after successful connections come first.
    const needle = query.trim()
    for (const spec of this.known.values()) {
      if (needle.length > 0 && !spec.name.includes(needle) && !spec.host.includes(needle)) continue
      seen.add(spec.name)
      results.push(spec)
    }
    for (const provider of this.providers.values()) {
      for (const spec of await provider.search(query)) {
        if (seen.has(spec.name)) continue
        seen.add(spec.name)
        results.push(spec)
      }
    }
    return results
  }
}

export default RemoteHostDirectory
