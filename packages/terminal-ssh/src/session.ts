/**
 * Persistent SSH PTY session over the subprocess terminal primitive.
 *
 * Readiness differs from the local bash backend: the remote shell prompt is
 * operator-controlled, so this backend detects completion with a sentinel
 * handshake (`; echo __DSH_READY__`) instead of the controlled-PS1 marker the
 * bash backend installs. The access token is written to the PTY when ssh asks
 * for a password and never appears in argv, tool arguments, results, or logs.
 *
 * @module @zealousw/dsh-terminal-ssh
 */

import { Buffer } from 'node:buffer'
import type {
  SubprocessOutcome,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import { TerminalError } from '@deepseek-ai/dsh-terminal'
import type {
  TerminalBackendSession,
  TerminalReadRequest,
  TerminalReadResult,
  TerminalSendOperation,
  TerminalSendRead,
  TerminalSendRequest,
  TerminalSendResult,
  TerminalSessionStatus,
  TerminalSignal,
  TerminalSignalResult,
  TerminalWaitReason,
} from '@deepseek-ai/dsh-terminal'
import type { ResolvedConfig } from './config.ts'

// The PTY-session state machine below mirrors packages/terminal/terminal-bash
// as a sentinel-handshake dialect (the bash backend uses a controlled-PS1
// marker plus sanitizer and pgid stdin-wait tracking). Extraction waits for
// the bash backend's planned send-state consolidation, so this parallel
// region is jscpd-ignored; rationale also lives in the README.
/* jscpd:ignore-start -- shared PTY-session state machine; consolidation deferred. */
function utf8Tail(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false }
  const chars = Array.from(text)
  let bytes = 0
  let start = chars.length
  while (start > 0) {
    const next = Buffer.byteLength(chars[start - 1] as string)
    if (bytes + next > maxBytes) break
    bytes += next
    start -= 1
  }
  return { text: chars.slice(start).join(''), truncated: true }
}

/**
 * The readiness sentinel a submitted send echoes as its own output line.
 * The interactive shell ALSO echoes the input line, whose text contains the
 * marker as a substring but never as a standalone line — an exact-line match
 * is what distinguishes the echo of the marker from the marker itself.
 */
export const READY_SENTINEL = '__DSH_READY__'

/** Whether the delta contains the readiness sentinel as its own output line. */
export function hasReadySentinel(text: string): boolean {
  return text.split(/\r?\n/).some(line => line.trim() === READY_SENTINEL)
}

/** Bounded text buffer shared by the scrollback and per-send viewports. */
class BoundedTextBuffer {
  private value = ''
  private dropped = false

  constructor(
    private readonly maxBytes: number,
    private readonly maxLines?: number,
  ) {}

  append(text: string): void {
    if (text.length === 0) return
    this.value += text
    if (this.maxLines !== undefined) {
      const lines = this.value.split('\n')
      if (lines.length > this.maxLines) {
        this.value = lines.slice(lines.length - this.maxLines).join('\n')
        this.dropped = true
      }
    }
    const tail = utf8Tail(this.value, this.maxBytes)
    this.value = tail.text
    this.dropped ||= tail.truncated
  }

  consume(): TerminalSendRead {
    const delta = this.value
    const truncated = this.dropped
    this.value = ''
    this.dropped = false
    return { delta, truncated }
  }

  snapshot(): { text: string; truncated: boolean } {
    return { text: this.value, truncated: this.dropped }
  }
}

/** One in-flight interactive send. */
class SshSendOperation implements TerminalSendOperation {
  private readonly output: BoundedTextBuffer
  private readonly promise: PromiseWithResolvers<TerminalSendResult>
  private finished = false
  private cancellationRequested = false

  constructor(
    maxBytes: number,
    readonly startedAt: number,
    private readonly onCancel: () => void,
  ) {
    this.output = new BoundedTextBuffer(maxBytes)
    this.promise = Promise.withResolvers<TerminalSendResult>()
  }

  get done(): Promise<TerminalSendResult> {
    return this.promise.promise
  }

  get settled(): boolean {
    return this.finished
  }

  get cancelRequested(): boolean {
    return this.cancellationRequested
  }

  append(text: string): void {
    if (!this.finished) this.output.append(text)
  }

  settle(
    waitReason: TerminalWaitReason,
    sessionStatus: TerminalSessionStatus,
    viewport: string,
    inheritedTruncation: boolean,
  ): void {
    if (this.finished) return
    this.finished = true
    this.promise.resolve({
      viewport,
      waitReason,
      sessionStatus,
      truncated: inheritedTruncation,
    })
  }

  fail(error: unknown): void {
    if (this.finished) return
    this.finished = true
    this.promise.reject(error)
  }

  readOutput(): TerminalSendRead {
    return this.output.consume()
  }

  cancel(): boolean {
    if (this.finished) return false
    this.cancellationRequested = true
    this.onCancel()
    return true
  }
}

/**
 * Backend session wrapping one `ssh` terminal process.
 *
 * The session keeps a bounded scrollback, runs one exclusive send at a time,
 * and settles a send when the configured prompt regex matches, the absolute
 * timeout fires, or the top-level ssh process exits. Startup waits for the
 * password prompt, writes the access token, then waits for the remote prompt.
 */
export class SshPtySession implements TerminalBackendSession {
  motd = ''
  readonly pid: number
  private readonly decoder = new TextDecoder()
  private readonly scrollback: BoundedTextBuffer
  private readonly outputEnded = Promise.withResolvers<void>()
  private readonly completion: Promise<void>
  private statusValue: TerminalSessionStatus = { kind: 'running' }
  private active: SshSendOperation | undefined
  private activeTimer: NodeJS.Timeout | undefined
  private activeDeadlineTimer: NodeJS.Timeout | undefined
  private activeAbort: (() => void) | undefined
  /** Scrollback length when the current send started; sentinel detection only
   * considers text after this offset so a stale marker cannot settle a new send. */
  private sendStartLength = 0
  private activeWrite: Promise<boolean> | undefined
  private lastOutputAt = Date.now()
  private closing = false
  private closePromise: Promise<void> | undefined
  private transportFailure: Error | undefined

  constructor(
    private readonly terminal: SubprocessTerminalHandle,
    private readonly config: ResolvedConfig,
    private readonly token: string,
  ) {
    this.pid = terminal.pid
    this.scrollback = new BoundedTextBuffer(config.scrollbackMaxBytes, config.scrollbackLines)
    terminal.output.on('data', this.onTerminalData)
    terminal.output.once('end', this.onTerminalEnd)
    terminal.output.once('error', this.onTerminalError)
    this.completion = terminal.done.then(
      outcome => this.onExit(outcome),
      (error: unknown) => { this.onTransportFailure(error) },
    )
  }

  /**
   * Reach startup readiness: answer the ssh password prompt with the access
   * token, then wait for the remote shell prompt.
   * @param signal - optional cancellation while the session reaches its first prompt.
   * @returns Resolves after readiness; rejects on exit, timeout, or cancellation.
   */
  /** Delay after the password is accepted for the remote shell to finish its banner. */
  private static readonly SHELL_READY_DELAY_MS = 1_500

  async initialize(signal?: AbortSignal): Promise<void> {
    await this.waitForPasswordPrompt(signal)
    await this.terminal.write(`${this.token}\r`)
    // Let the remote shell finish its login banner before sending the sentinel;
    // a marker written too early is swallowed by the still-initializing shell.
    await new Promise(resolve => setTimeout(resolve, SshPtySession.SHELL_READY_DELAY_MS))
    // Sentinel handshake: emit a unique marker and wait for its echo instead
    // of matching an operator-controlled remote prompt. This is robust against
    // any prompt format, trailing CRLF, or banner noise.
    const operation = this.startSend({ text: 'echo __DSH_READY__', submit: true, ...signal !== undefined ? { signal } : {} })
    const result = await operation.done
    if (result.waitReason === 'session_exit') throw new Error('ssh session exited during startup')
    if (result.waitReason === 'timeout') throw new Error('ssh session did not reach readiness before startup timeout')
    this.motd = result.viewport
  }

  /**
   * Wait until ssh prints its password prompt or the startup deadline passes.
   * @param signal - optional cancellation of the wait.
   * @returns Resolves when the password prompt is visible in the scrollback.
   */
  private async waitForPasswordPrompt(signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.config.timeoutMs
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      if (this.statusValue.kind === 'exited') throw new Error('ssh exited before the password prompt')
      if (/[Pp]assword\s*[:：]/.test(this.scrollback.snapshot().text)) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('ssh did not present a password prompt before timeout')
  }

  startSend(request: TerminalSendRequest): TerminalSendOperation {
    if (this.closing) throw new Error('PTY session is closing')
    if (this.statusValue.kind === 'exited') throw new Error('PTY session has exited')
    if (this.active !== undefined) {
      throw new TerminalError('PTY session already has an active send', 'SEND_ACTIVE')
    }
    if (request.signal?.aborted === true) throw new Error('PTY send aborted before write')

    const operation = new SshSendOperation(
      this.config.maxReadBytes,
      Date.now(),
      () => { this.interrupt(operation) },
    )
    this.active = operation
    this.lastOutputAt = Date.now()
    this.sendStartLength = this.scrollback.snapshot().text.length

    if (request.signal !== undefined) {
      const onAbort = (): void => { operation.cancel() }
      request.signal.addEventListener('abort', onAbort, { once: true })
      this.activeAbort = () => request.signal?.removeEventListener('abort', onAbort)
    }
    this.activeDeadlineTimer = setTimeout(() => {
      if (this.active === operation) this.settleActive('timeout', this.activeWrite !== undefined)
    }, this.config.timeoutMs)
    void this.beginSend(operation, request)
    return operation
  }

  private async beginSend(operation: SshSendOperation, request: TerminalSendRequest): Promise<void> {
    try {
      if (this.active !== operation || this.closing) return
      // Every submitted send appends a sentinel so completion is detectable:
      // pollReadiness settles when the marker echoes, independent of the
      // operator-controlled prompt format. initialize() relies on this too.
      const input = request.text.length > 0 && request.submit
        ? `${request.text}; echo __DSH_READY__`
        : request.text
      if (input.length > 0 && !operation.cancelRequested) {
        const write = this.terminal.write(input)
        this.activeWrite = write.then(() => true, () => false)
        try {
          await write
        } finally {
          this.activeWrite = undefined
        }
      }
      if (request.submit && input.length > 0) {
        const write = this.terminal.write('\r')
        this.activeWrite = write.then(() => true, () => false)
        try {
          await write
        } finally {
          this.activeWrite = undefined
        }
      }
      if (operation.cancelRequested) return
      if (this.active === operation && operation.settled) {
        this.clearActive()
        return
      }
      if (this.active === operation) {
        this.schedulePoll(operation)
      }
    } catch (error: unknown) {
      if (this.active === operation && !this.closing) {
        if (operation.settled) this.clearActive()
        else this.failActive(error)
      }
    }
  }

  private schedulePoll(operation: SshSendOperation, delayMs = 50): void {
    if (this.active !== operation || this.polling) return
    if (this.activeTimer !== undefined) clearTimeout(this.activeTimer)
    this.activeTimer = setTimeout(() => {
      this.activeTimer = undefined
      void this.pollReadiness(operation)
    }, delayMs)
  }

  private polling = false

  private async pollReadiness(operation: SshSendOperation): Promise<void> {
    if (this.active !== operation || this.polling) return
    this.polling = true
    try {
      if (this.statusValue.kind === 'exited') {
        this.settleActive('session_exit')
        return
      }
      if (this.active !== operation) return
      // Readiness = the sentinel appeared in the delta as its own output
      // line AND the output has been quiet long enough to avoid settling on
      // the marker's own echo. The idle bound mirrors the bash backend's
      // inference; the exact-line match rejects the shell's echoed input line,
      // which contains the marker text only as a substring.
      const snapshot = this.scrollback.snapshot()
      const delta = snapshot.text.slice(this.sendStartLength)
      const idleFor = Date.now() - this.lastOutputAt
      if (hasReadySentinel(delta) && idleFor >= 50) {
        this.settleActive('stdin_read')
        return
      }
      // Without a prompt match, keep polling on an awaitable delay so the
      // function is genuinely async and cancellation can interrupt it.
      await new Promise<void>(resolve => setTimeout(resolve, 50))
    } catch (error: unknown) {
      if (this.active === operation && !this.closing) this.failActive(error)
    } finally {
      this.polling = false
      // Re-schedule only after releasing the polling guard, mirroring the bash
      // backend: a schedule inside the try would be rejected by its own guard.
      if (this.active === operation && !this.closing) this.schedulePoll(operation)
    }
  }

  read(request: TerminalReadRequest): TerminalReadResult {
    const snapshot = this.scrollback.snapshot()
    const lines = snapshot.text.split('\n')
    const totalLines = snapshot.text.length === 0 ? 0 : lines.length
    const offset = request.offset ?? 0
    const count = request.count ?? 500
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('PTY read offset must be a non-negative safe integer')
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error('PTY read count must be a positive safe integer')
    if (offset >= totalLines) {
      return { text: '', totalLines, lineBegin: offset, lineEnd: offset, truncated: snapshot.truncated }
    }
    const end = totalLines - offset
    const start = Math.max(0, end - count)
    const requested = lines.slice(start, end).join('\n')
    const bounded = utf8Tail(requested, this.config.maxReadBytes)
    const returnedLines = bounded.text.length === 0 ? 0 : bounded.text.split('\n').length
    return {
      text: bounded.text,
      totalLines,
      lineBegin: offset,
      lineEnd: offset + returnedLines,
      truncated: snapshot.truncated || bounded.truncated,
    }
  }

  async signal(signal: TerminalSignal): Promise<TerminalSignalResult> {
    if (this.closing) throw new Error('PTY session is closing')
    const targetPgid = await this.terminal.signalForeground(signal)
    return { delivered: true, targetPgid }
  }

  status(): TerminalSessionStatus {
    return this.statusValue
  }

  close(reason: string): Promise<void> {
    this.closing = true
    if (this.closePromise !== undefined) return this.closePromise
    const closing = this.closeOnce(reason).catch((error: unknown) => {
      this.closePromise = undefined
      this.failActive(error)
      throw error
    })
    this.closePromise = closing
    return closing
  }

  private readonly onTerminalData = (chunk: Buffer | Uint8Array | string): void => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    this.onData(this.decoder.decode(bytes, { stream: true }))
  }

  private readonly onTerminalEnd = (): void => {
    this.onData(this.decoder.decode())
    this.outputEnded.resolve()
  }

  private readonly onTerminalError = (error: Error): void => {
    this.onTransportFailure(error)
    this.outputEnded.resolve()
  }

  private onData(data: string): void {
    this.appendOutput(data)
  }

  private async onExit(outcome: SubprocessOutcome): Promise<void> {
    await this.outputEnded.promise
    if (this.transportFailure !== undefined) return
    this.statusValue = { kind: 'exited', exitCode: outcome.exitCode, signal: outcome.signal }
    this.settleActive('session_exit')
  }

  private onTransportFailure(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error))
    this.transportFailure ??= failure
    this.statusValue = { kind: 'exited', exitCode: null, signal: null }
    this.failActive(failure)
    void this.terminal.terminate().catch(() => {})
  }

  private appendOutput(text: string): void {
    if (text.length === 0) return
    this.lastOutputAt = Date.now()
    this.scrollback.append(text)
    this.active?.append(text)
  }

  private settleActive(waitReason: TerminalWaitReason, retainOwnership = false): void {
    const operation = this.active
    if (operation === undefined) return
    const snapshot = this.scrollback.snapshot()
    const scrollbackTruncated = snapshot.truncated
    // The viewport is the scrollback delta since this send started: PTY output
    // is asynchronous, so bytes produced by this command may still arrive after
    // the sentinel echoes. The independent send buffer would miss them.
    const delta = snapshot.text.slice(this.sendStartLength)
    if (retainOwnership) {
      this.stopPolling()
      this.activeAbort?.()
      this.activeAbort = undefined
    } else {
      this.clearActive()
    }
    operation.settle(waitReason, this.statusValue, delta, scrollbackTruncated)
  }

  private stopPolling(): void {
    if (this.activeTimer !== undefined) clearTimeout(this.activeTimer)
    this.activeTimer = undefined
    if (this.activeDeadlineTimer !== undefined) clearTimeout(this.activeDeadlineTimer)
    this.activeDeadlineTimer = undefined
  }

  private clearActive(): void {
    this.stopPolling()
    this.activeAbort?.()
    this.activeAbort = undefined
    this.polling = false
    this.active = undefined
  }

  private failActive(error: unknown): void {
    const operation = this.active
    if (operation === undefined) return
    this.clearActive()
    operation.fail(error)
  }

  private interrupt(operation: SshSendOperation): void {
    if (this.active !== operation) return
    this.stopPolling()
    void this.terminal.signalForeground('SIGINT').catch((error: unknown) => {
      if (this.active === operation && !this.closing) this.onTransportFailure(error)
    })
  }

  private async closeOnce(reason: string): Promise<void> {
    this.stopPolling()
    try {
      await this.terminal.terminate()
    } catch (error: unknown) {
      throw new Error(`PTY cleanup failed (${reason})`, { cause: error })
    }
    this.settleActive('session_exit')
    await this.completion
    this.terminal.output.off('data', this.onTerminalData)
    this.terminal.output.off('end', this.onTerminalEnd)
    this.terminal.output.off('error', this.onTerminalError)
    if (this.transportFailure !== undefined) throw this.transportFailure
  }
}
/* jscpd:ignore-end */
