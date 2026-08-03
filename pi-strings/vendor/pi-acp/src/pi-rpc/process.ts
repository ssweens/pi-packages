import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { getPiCommand, shouldUseShellForPiCommand } from './command.js'

export class PiRpcSpawnError extends Error {
  /** Underlying spawn error code, e.g. ENOENT, EACCES */
  code: string | undefined

  constructor(message: string, opts?: { code?: string; cause?: unknown }) {
    super(message)
    this.name = 'PiRpcSpawnError'
    this.code = opts?.code
    ;(this as any).cause = opts?.cause
  }
}

const ESC = String.fromCharCode(0x1b)
const CSI = String.fromCharCode(0x9b)

const ANSI_ESCAPE_REGEX = new RegExp(
  `[${ESC}${CSI}][[\\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`,
  'g'
)

function stripAnsi(s: string): string {
  // Basic ANSI escape stripping (colors, cursor movement, etc.)
  return s.replace(ANSI_ESCAPE_REGEX, '')
}

function parseWorkerTools(raw: string | undefined): string[] {
  if (!raw) throw new Error('PI_STRINGS_PI_TOOLS is required for a pi-strings worker')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every(value => typeof value === 'string')) {
    throw new Error('PI_STRINGS_PI_TOOLS must be a JSON string array')
  }
  return parsed
}

type PiRpcCommand =
  | { type: 'prompt'; id?: string; message: string; images?: unknown[] }
  | { type: 'steer'; id?: string; message: string; images?: unknown[] }
  | { type: 'abort'; id?: string }
  | { type: 'get_state'; id?: string }
  // Model
  | { type: 'get_available_models'; id?: string }
  | { type: 'set_model'; id?: string; provider: string; modelId: string }
  // Thinking
  | { type: 'set_thinking_level'; id?: string; level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' }
  // Modes
  | { type: 'set_follow_up_mode'; id?: string; mode: 'all' | 'one-at-a-time' }
  | { type: 'set_steering_mode'; id?: string; mode: 'all' | 'one-at-a-time' }
  // Compaction
  | { type: 'compact'; id?: string; customInstructions?: string }
  | { type: 'set_auto_compaction'; id?: string; enabled: boolean }
  // Session
  | { type: 'get_session_stats'; id?: string }
  | { type: 'set_session_name'; id?: string; name: string }
  | { type: 'export_html'; id?: string; outputPath?: string }
  | { type: 'switch_session'; id?: string; sessionPath: string }
  // Messages
  | { type: 'get_messages'; id?: string }
  // Commands
  | { type: 'get_commands'; id?: string }

type PiRpcResponse = {
  type: 'response'
  id?: string
  command: string
  success: boolean
  data?: unknown
  error?: string
}

type PiExtensionUiResponse =
  | { id: string; value: string }
  | { id: string; confirmed: boolean }
  | { id: string; cancelled: true }

export type PiRpcEvent = Record<string, unknown>

type SpawnParams = {
  cwd: string
  /** Optional override for `pi` executable name/path */
  piCommand?: string
  /** If set, pi will persist the session to this exact file (via `--session <path>`). */
  sessionPath?: string
  startupTimeoutMs?: number
}

type RequestOptions = { signal?: AbortSignal; timeoutMs?: number }

type PendingRequest = {
  command: string
  resolve: (value: PiRpcResponse) => void
  reject: (error: unknown) => void
  timer: NodeJS.Timeout
  cleanupAbort: () => void
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const MAX_RECORD_BYTES = 16 * 1024 * 1024
const STDERR_TAIL_BYTES = 16 * 1024

export class PiRpcProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<string, PendingRequest>()
  private eventHandlers: Array<(ev: PiRpcEvent) => void> = []
  private readonly preludeLines: string[] = []
  private stdoutBuffer = Buffer.alloc(0)
  private stderrTail = Buffer.alloc(0)
  private protocolStarted = false
  private protocolError: Error | null = null
  private handshakeState: unknown
  private terminationPromise: Promise<void> | null = null

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child

    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk))
    child.stdout.on('end', () => {
      if (this.stdoutBuffer.length > 0) this.failProtocol(new Error('pi RPC stdout ended with an unterminated JSONL record'))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = Buffer.concat([this.stderrTail, chunk]).subarray(-STDERR_TAIL_BYTES)
    })

    child.on('exit', (code, signal) => this.rejectPending(new Error(`pi process exited (code=${code}, signal=${signal})${this.stderrSummary()}`)))
    child.on('error', err => this.rejectPending(err))
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])
    if (this.stdoutBuffer.length > MAX_RECORD_BYTES && !this.stdoutBuffer.includes(0x0a)) {
      this.failProtocol(new Error(`pi RPC record exceeded ${MAX_RECORD_BYTES} bytes`))
      return
    }
    for (;;) {
      const newline = this.stdoutBuffer.indexOf(0x0a)
      if (newline < 0) return
      if (newline > MAX_RECORD_BYTES) {
        this.failProtocol(new Error(`pi RPC record exceeded ${MAX_RECORD_BYTES} bytes`))
        return
      }
      let record = this.stdoutBuffer.subarray(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1)
      if (record.at(-1) === 0x0d) record = record.subarray(0, -1)
      if (record.length === 0) continue
      this.handleRecord(record.toString('utf8'))
      if (this.protocolError) return
    }
  }

  private handleRecord(line: string): void {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch (error) {
      if (!this.protocolStarted) {
        const cleaned = stripAnsi(line).trimEnd()
        if (cleaned) this.preludeLines.push(cleaned)
        return
      }
      this.failProtocol(new Error(`Malformed pi RPC JSON after handshake: ${error instanceof Error ? error.message : String(error)}`))
      return
    }
    this.protocolStarted = true
    if (msg?.type === 'response') {
      const id = typeof msg.id === 'string' ? msg.id : undefined
      if (id) {
        const pending = this.pending.get(id)
        if (pending) {
          this.finishPending(id)
          pending.resolve(msg as PiRpcResponse)
        }
      }
      return
    }
    for (const handler of this.eventHandlers) handler(msg as PiRpcEvent)
  }

  private finishPending(id: string): void {
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    pending.cleanupAbort()
    this.pending.delete(id)
  }

  private rejectPending(error: unknown): void {
    for (const [id, pending] of this.pending) {
      this.finishPending(id)
      pending.reject(error)
    }
  }

  private failProtocol(error: Error): void {
    if (this.protocolError) return
    this.protocolError = error
    this.rejectPending(error)
    void this.terminate()
  }

  stderrSummary(): string {
    const text = stripAnsi(this.stderrTail.toString('utf8')).trim()
    return text ? `\npi stderr tail:\n${text}` : ''
  }

  static async spawn(params: SpawnParams): Promise<PiRpcProcess> {
    // On Windows, npm commonly creates pi.cmd / pi.bat launcher scripts.
    const cmd = getPiCommand(params.piCommand)

    // Speed/robustness for ACP:
    // - themes are irrelevant in rpc mode and can be noisy/slow to load.
    // Keep extensions + prompt templates enabled because ACP users may rely on them
    // (e.g. MCP extensions, prompt templates for workflows).
    const args = ['--mode', 'rpc', '--no-themes']
    if (process.env.PI_STRINGS_WORKER === '1') {
      args.push('--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files')
      const configuredTools = parseWorkerTools(process.env.PI_STRINGS_PI_TOOLS)
      args.push('--tools', configuredTools.join(','))
      if (process.env.PI_STRINGS_PI_THINKING) args.push('--thinking', process.env.PI_STRINGS_PI_THINKING)
    }
    if (params.sessionPath) args.push('--session', params.sessionPath)

    const child = spawn(cmd, args, {
      cwd: params.cwd,
      stdio: 'pipe',
      env: process.env,
      shell: shouldUseShellForPiCommand(cmd),
      detached: process.platform !== 'win32'
    })

    // Ensure spawn failures (e.g. ENOENT when pi isn't installed) are surfaced as a
    // deterministic error instead of later EPIPE/internal-error noise.
    try {
      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          cleanup()
          resolve()
        }
        const onError = (err: any) => {
          cleanup()
          reject(err)
        }
        const cleanup = () => {
          child.off('spawn', onSpawn)
          child.off('error', onError)
        }

        child.once('spawn', onSpawn)
        child.once('error', onError)
      })
    } catch (e: any) {
      const code = typeof e?.code === 'string' ? e.code : undefined
      if (code === 'ENOENT') {
        throw new PiRpcSpawnError(
          `Could not start pi: executable not found (command: ${cmd}). Pi needs to be installed before it can run in ACP clients. Install it via \`npm install -g @earendil-works/pi-coding-agent\` or ensure \`pi\` is on your PATH. Then try again.`,
          { code, cause: e }
        )
      }

      if (code === 'EACCES') {
        throw new PiRpcSpawnError(`Could not start pi: permission denied (command: ${cmd}).`, { code, cause: e })
      }

      throw new PiRpcSpawnError(`Could not start pi (command: ${cmd}).`, { code, cause: e })
    }

    const proc = new PiRpcProcess(child)

    // A process is not ready until it answers a correlated RPC request.
    // Important: pi may emit a get_state response pointing at a sessionFile in a directory
    // that is created lazily. Create the parent dir up-front to avoid later parse errors
    // when we call commands like export_html.
    try {
      const state = (await proc.getState({ timeoutMs: params.startupTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS })) as any
      if (!state || typeof state !== 'object') throw new Error('pi get_state returned an invalid payload')
      proc.handshakeState = state
      const sessionFile = typeof state.sessionFile === 'string' ? state.sessionFile : null
      if (sessionFile) {
        const { mkdirSync } = await import('node:fs')
        const { dirname } = await import('node:path')
        mkdirSync(dirname(sessionFile), { recursive: true })
      }
    } catch (error) {
      await proc.terminate()
      throw new PiRpcSpawnError(`pi RPC handshake failed: ${error instanceof Error ? error.message : String(error)}${proc.stderrSummary()}`, { cause: error })
    }

    return proc
  }

  onEvent(handler: (ev: PiRpcEvent) => void): () => void {
    this.eventHandlers.push(handler)
    return () => {
      this.eventHandlers = this.eventHandlers.filter(h => h !== handler)
    }
  }

  dispose(): void {
    void this.terminate()
  }

  terminate(graceMs = 2_000): Promise<void> {
    return this.terminationPromise ??= this.terminateOnce(graceMs)
  }

  private async terminateOnce(graceMs: number): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    try { this.child.stdin.end() } catch { /* already closed */ }
    if (await this.waitForExit(Math.min(graceMs, 500))) return
    this.signalTree('SIGTERM')
    if (await this.waitForExit(graceMs)) return
    this.signalTree('SIGKILL')
    await this.waitForExit(graceMs)
  }

  private signalTree(signal: NodeJS.Signals): void {
    try {
      if (process.platform !== 'win32' && this.child.pid) process.kill(-this.child.pid, signal)
      else this.child.kill(signal)
    } catch {
      try { this.child.kill(signal) } catch { /* process already exited */ }
    }
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve(true)
    return new Promise(resolve => {
      const timer = setTimeout(() => { cleanup(); resolve(false) }, timeoutMs)
      const onExit = () => { cleanup(); resolve(true) }
      const cleanup = () => { clearTimeout(timer); this.child.off('exit', onExit) }
      this.child.once('exit', onExit)
    })
  }

  getHandshakeState(): unknown {
    return this.handshakeState
  }

  /**
   * Human-readable stdout lines emitted before RPC NDJSON begins (e.g. Context/Skills/Extensions info).
   * Themes are typically noisy/less useful for ACP, so callers can filter as needed.
   */
  consumePreludeLines(): string[] {
    const lines = this.preludeLines.splice(0, this.preludeLines.length)
    return lines
  }

  async prompt(message: string, images: unknown[] = []): Promise<void> {
    const res = await this.request({ type: 'prompt', message, images })
    if (!res.success) throw new Error(`pi prompt failed: ${res.error ?? JSON.stringify(res.data)}`)
  }

  async steer(message: string, images: unknown[] = []): Promise<void> {
    const res = await this.request({ type: 'steer', message, images })
    if (!res.success) throw new Error(`pi steer failed: ${res.error ?? JSON.stringify(res.data)}`)
  }

  async abort(): Promise<void> {
    const res = await this.request({ type: 'abort' })
    if (!res.success) throw new Error(`pi abort failed: ${res.error ?? JSON.stringify(res.data)}`)
  }

  async getState(options?: RequestOptions): Promise<unknown> {
    const res = await this.request({ type: 'get_state' }, options)
    if (!res.success) throw new Error(`pi get_state failed: ${res.error ?? JSON.stringify(res.data)}`)
    return res.data
  }

  async getAvailableModels(options?: RequestOptions): Promise<unknown> {
    const res = await this.request({ type: 'get_available_models' }, options)
    if (!res.success) throw new Error(`pi get_available_models failed: ${res.error ?? JSON.stringify(res.data)}`)
    return res.data
  }

  async setModel(provider: string, modelId: string): Promise<unknown> {
    const res = await this.request({ type: 'set_model', provider, modelId })
    if (!res.success) throw new Error(`pi set_model failed: ${res.error ?? JSON.stringify(res.data)}`)
    return res.data
  }

  async setThinkingLevel(level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'): Promise<void> {
    const res = await this.request({ type: 'set_thinking_level', level })
    if (!res.success) throw new Error(`pi set_thinking_level failed: ${res.error ?? JSON.stringify(res.data)}`)
  }

  async setFollowUpMode(mode: 'all' | 'one-at-a-time'): Promise<void> {
    const res = await this.request({ type: 'set_follow_up_mode', mode })
    if (!res.success) throw new Error(`pi set_follow_up_mode failed: ${res.error ?? JSON.stringify(res.data)}`)
  }

  async setSteeringMode(mode: 'all' | 'one-at-a-time'): Promise<void> {
    const res = await this.request({ type: 'set_steering_mode', mode })
    if (!res.success) throw new Error(`pi set_steering_mode failed: ${res.error ?? JSON.stringify(res.data)}`)
  }

  async compact(customInstructions?: string): Promise<unknown> {
    const res = await this.request({ type: 'compact', ...(customInstructions !== undefined ? { customInstructions } : {}) })
    if (!res.success) throw new Error(`pi compact failed: ${res.error ?? JSON.stringify(res.data)}`)
    return res.data
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    const res = await this.request({ type: 'set_auto_compaction', enabled })
    if (!res.success) throw new Error(`pi set_auto_compaction failed: ${res.error ?? JSON.stringify(res.data)}`)
  }

  async getSessionStats(): Promise<unknown> {
    const res = await this.request({ type: 'get_session_stats' })
    if (!res.success) throw new Error(`pi get_session_stats failed: ${res.error ?? JSON.stringify(res.data)}`)
    return res.data
  }

  async setSessionName(name: string): Promise<void> {
    const res = await this.request({ type: 'set_session_name', name })
    if (!res.success) throw new Error(`pi set_session_name failed: ${res.error ?? JSON.stringify(res.data)}`)
  }

  async exportHtml(outputPath?: string): Promise<{ path: string }> {
    const res = await this.request({ type: 'export_html', ...(outputPath !== undefined ? { outputPath } : {}) })
    if (!res.success) throw new Error(`pi export_html failed: ${res.error ?? JSON.stringify(res.data)}`)
    const data: any = res.data
    return { path: String(data?.path ?? '') }
  }

  async switchSession(sessionPath: string): Promise<void> {
    const res = await this.request({ type: 'switch_session', sessionPath })
    if (!res.success) throw new Error(`pi switch_session failed: ${res.error ?? JSON.stringify(res.data)}`)
  }

  async getMessages(): Promise<unknown> {
    const res = await this.request({ type: 'get_messages' })
    if (!res.success) throw new Error(`pi get_messages failed: ${res.error ?? JSON.stringify(res.data)}`)
    return res.data
  }

  async getCommands(): Promise<unknown> {
    const res = await this.request({ type: 'get_commands' })
    if (!res.success) throw new Error(`pi get_commands failed: ${res.error ?? JSON.stringify(res.data)}`)
    return res.data
  }

  async sendExtensionUiResponse(response: PiExtensionUiResponse): Promise<void> {
    await this.writeLine(`${JSON.stringify({ type: 'extension_ui_response', ...response })}\n`)
  }

  private request(cmd: PiRpcCommand, options: RequestOptions = {}): Promise<PiRpcResponse> {
    const id = crypto.randomUUID()
    const command = cmd.type
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? new Error(`pi RPC ${command} aborted`))
    if (this.protocolError) return Promise.reject(this.protocolError)

    return new Promise<PiRpcResponse>((resolve, reject) => {
      const onAbort = () => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.finishPending(id)
        pending.reject(options.signal?.reason ?? new Error(`pi RPC ${command} aborted`))
      }
      const timer = setTimeout(() => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.finishPending(id)
        pending.reject(new Error(`pi RPC ${command} timed out after ${timeoutMs}ms${this.stderrSummary()}`))
      }, timeoutMs)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        command,
        resolve,
        reject,
        timer,
        cleanupAbort: () => options.signal?.removeEventListener('abort', onAbort)
      })
      void this.writeLine(`${JSON.stringify({ ...cmd, id })}\n`).catch(error => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.finishPending(id)
        pending.reject(error)
      })
    })
  }

  private writeLine(line: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.child.stdin.write(line, error => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      } catch (error: unknown) {
        reject(error)
      }
    })
  }
}
