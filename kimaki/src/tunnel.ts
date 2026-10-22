// `kimaki tunnel`: run a command, find the local port it listens on, and expose
// it at https://<route>.<id>.opentunnel.xyz. TLS ends in this process, so the
// relay never sees plaintext. The tunnel identity is the default opentunnel
// profile in $XDG_DATA_HOME/opentunnel, shared with the opentunnel CLI.

import crypto from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify, stripVTControlCharacters } from 'node:util'
import { create as createOpenTunnel, type OpenTunnelConnection } from '@opentunnel/client'

const execFileAsync = promisify(execFile)

const ROUTE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const PORT_WAIT_MS = 30_000
const ATTACH_TIMEOUT_MS = 60_000
const CHILD_KILL_GRACE_MS = 5_000

// Only lines with host:port, so "Port 5173 is in use" does not match.
const LOCAL_PORT_PATTERN = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d{1,5})/i
const IGNORED_LINE_PATTERNS = [/\bdebugger (?:listening|attached)\b/i, /\bdevtools listening\b/i]

export function detectPortFromText(text: string): number | null {
  // Vite colors the port separately, so strip ANSI before matching.
  for (const line of stripVTControlCharacters(text).split('\n')) {
    if (IGNORED_LINE_PATTERNS.some((pattern) => pattern.test(line))) continue
    const port = Number(line.match(LOCAL_PORT_PATTERN)?.[1])
    if (port >= 1 && port <= 65_535) return port
  }
  return null
}

// Traforo accepted any tunnel ID, so map it to a DNS label instead of failing: `My_App` becomes `my-app`.
function toRouteLabel(raw: string): string {
  const label = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '')
  return ROUTE_NAME.test(label) ? label : ''
}

// Explicit name, then the tuistory session ID (stable URL across restarts of one session), then random.
export function routeName({ name, tuistorySessionId }: { name?: string; tuistorySessionId?: string }): string | Error {
  if (name) return toRouteLabel(name) || new Error(`Invalid tunnel ID ${JSON.stringify(name)}: use letters, digits and dashes`)
  return toRouteLabel(tuistorySessionId ?? '') || crypto.randomBytes(8).toString('hex')
}

// Parses `netstat -ano` output on Windows: `TCP  0.0.0.0:5173  0.0.0.0:0  LISTENING  1234`.
export function parseNetstatListeningPids({ stdout, port }: { stdout: string; port: number }): number[] {
  const pids = new Set<number>()
  for (const line of stdout.split('\n')) {
    const [protocol, local, , state, pid] = line.trim().split(/\s+/)
    if (protocol !== 'TCP' || state !== 'LISTENING' || !local?.endsWith(`:${port}`)) continue
    const parsed = Number(pid)
    if (Number.isInteger(parsed) && parsed > 0) pids.add(parsed)
  }
  return [...pids]
}

function isPortInUse({ port, host }: { port: number; host: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
  })
}

async function waitForPort({ port, host, signal }: { port: number; host: string; signal: AbortSignal }): Promise<void | Error> {
  while (!(await isPortInUse({ port, host }))) {
    if (signal.aborted) return new Error(`Timed out waiting for ${host}:${port} to accept connections`)
    await sleep(300)
  }
}

async function listeningPids(port: number): Promise<number[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('netstat', ['-ano'], { timeout: 5_000 }).catch(() => ({ stdout: '' }))
    return parseNetstatListeningPids({ stdout, port })
  }
  const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { timeout: 5_000 }).catch(() => ({ stdout: '' }))
  return stdout.split('\n').map(Number).filter((pid) => Number.isInteger(pid) && pid > 0)
}

async function killProcessOnPort({ port, host }: { port: number; host: string }): Promise<void | Error> {
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    for (const pid of await listeningPids(port)) {
      try { process.kill(pid, signal) } catch {}
    }
    for (let waited = 0; waited < 3_000; waited += 200) {
      if (!(await isPortInUse({ port, host }))) return
      await sleep(200)
    }
  }
  return new Error(`Port ${port} is still in use after --kill`)
}

function detectPortFromOutput({ child, signal }: { child: ChildProcess; signal: AbortSignal }): Promise<number | Error> {
  return new Promise((resolve) => {
    let buffer = ''
    const finish = (result: number | Error) => {
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      child.off('exit', onExit)
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onData = (chunk: Buffer) => {
      buffer = (buffer + chunk.toString()).slice(-8_000)
      const port = detectPortFromText(buffer)
      if (port) finish(port)
    }
    const onExit = (code: number | null) => finish(new Error(`Command exited with code ${code} before printing a localhost URL. Pass --port`))
    const onAbort = () => finish(new Error(`No localhost URL in the command output after ${PORT_WAIT_MS / 1000}s. Pass --port`))
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', onExit)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function killChild(child: ChildProcess | undefined, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, CHILD_KILL_GRACE_MS)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill(signal)
  })
}

const log = (line: string) => process.stderr.write(`${line}\n`)

function forwardedHeaders({ headers, target }: { headers: http.IncomingHttpHeaders; target: string }): http.OutgoingHttpHeaders {
  return {
    ...headers,
    host: target,
    'x-forwarded-host': headers['x-forwarded-host'] ?? headers.host,
    'x-forwarded-proto': headers['x-forwarded-proto'] ?? 'https',
  }
}

function rawResponseHead(response: http.IncomingMessage): string {
  let head = `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`
  for (let i = 0; i < response.rawHeaders.length; i += 2) head += `${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`
  return `${head}\r\n`
}

// opentunnel forwards the raw bytes, so the app would see the public Host header. Vite and other dev
// servers reject unknown hosts (DNS rebinding protection) with 403. This loopback proxy sends
// Host: localhost:<port> and keeps the public host in X-Forwarded-Host, like traforo did.
export function startHostProxy({ host, port }: { host: string; port: number }): Promise<http.Server | Error> {
  const target = `${host}:${port}`
  const server = http.createServer((req, res) => {
    const upstream = http.request({ host, port, method: req.method, path: req.url, headers: forwardedHeaders({ headers: req.headers, target }) }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.statusMessage, response.rawHeaders)
      response.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })

  // WebSocket upgrades (Vite HMR): replay the handshake upstream, then pipe both sockets.
  server.on('upgrade', (req, socket, head) => {
    const upstream = http.request({ host, port, method: req.method, path: req.url, headers: forwardedHeaders({ headers: req.headers, target }) })
    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      socket.write(rawResponseHead(response))
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      if (head.length > 0) upstreamSocket.write(head)
      upstreamSocket.on('error', () => socket.destroy())
      socket.on('error', () => upstreamSocket.destroy())
      upstreamSocket.pipe(socket).pipe(upstreamSocket)
    })
    upstream.on('response', (response) => {
      socket.write(rawResponseHead(response))
      response.pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    upstream.end()
  })

  return new Promise((resolve) => {
    server.once('error', (cause) => resolve(new Error('Could not start the tunnel proxy', { cause })))
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

export async function runTunnel(options: {
  port?: number
  command?: string[]
  name?: string
  host?: string
  kill?: boolean
}): Promise<void | Error> {
  const host = options.host ?? 'localhost'
  const route = routeName({ name: options.name, tuistorySessionId: process.env['TUISTORY_SESSION_ID'] })
  if (route instanceof Error) return route
  if (options.kill && !options.port) return new Error('--kill needs --port')

  if (options.port && options.kill) {
    const killed = await killProcessOnPort({ port: options.port, host })
    if (killed instanceof Error) return killed
  } else if (options.port && options.command && (await isPortInUse({ port: options.port, host }))) {
    return new Error(`Port ${options.port} is already in use. Pass --kill to stop the process on it first`)
  }

  const client = createOpenTunnel()
  const existing = await client.tunnel.get().catch(() => undefined)
  if (!existing) log('Creating the opentunnel.xyz tunnel of this machine (waits for a certificate, up to a minute)...')
  const identity = await client.tunnel.ensure().catch((cause: unknown) => new Error('Could not create the opentunnel tunnel', { cause }))
  if (identity instanceof Error) return identity
  const url = `https://${route}.${identity.hostname}`

  let child: ChildProcess | undefined
  let connection: OpenTunnelConnection | undefined
  // Set before we kill the child ourselves, so its exit does not end the process first.
  let stopping = false
  const shutdown = async (signal: NodeJS.Signals) => {
    if (stopping) return
    stopping = true
    log('Shutting down...')
    await connection?.close().catch(() => undefined)
    await killChild(child, signal)
    process.exit(0)
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => void shutdown(signal))

  if (options.command) {
    const [cmd, ...args] = options.command
    child = spawn(cmd!, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(options.port && { PORT: String(options.port) }),
        KIMAKI_TUNNEL_URL: url,
        // Old name from traforo, kept so existing app configs still work.
        TRAFORO_URL: url,
        // wrangler dev passes parent env vars as worker bindings, so workers can read KIMAKI_TUNNEL_URL.
        CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
        FORCE_COLOR: '1',
        VITE_CLS: 'false',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    })
    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)
    child.on('error', (error) => { log(`Failed to start command: ${error.message}`); process.exit(1) })
    child.on('exit', (code, signal) => {
      if (stopping) return
      log(`Command exited with ${signal ?? `code ${code}`}`)
      process.exit(code ?? 1)
    })
  }

  const fail = async (error: Error) => { stopping = true; await killChild(child); return error }

  let port = options.port
  const portSignal = AbortSignal.timeout(PORT_WAIT_MS)
  if (!port && child) {
    const detected = await detectPortFromOutput({ child, signal: portSignal })
    if (detected instanceof Error) return fail(detected)
    port = detected
  }
  if (!port) return fail(new Error('Could not find the local port. Pass --port'))
  const ready = await waitForPort({ port, host, signal: portSignal })
  if (ready instanceof Error) return fail(ready)
  const proxy = await startHostProxy({ host, port })
  if (proxy instanceof Error) return fail(proxy)
  const proxyAddress = proxy.address()
  if (!proxyAddress || typeof proxyAddress === 'string') return fail(new Error('Tunnel proxy has no TCP address'))

  // connect retries route_conflict forever, so a route held by another process would hang here.
  const connecting = client.tunnel.connect({ routes: { [route]: `127.0.0.1:${proxyAddress.port}` } })
  const timeout = sleep(ATTACH_TIMEOUT_MS, null, { ref: false })
  const attached = await Promise.race([connecting, timeout]).catch((cause: unknown) => new Error('Could not connect the tunnel', { cause }))
  if (attached instanceof Error) return fail(attached)
  if (!attached) return fail(new Error(`Tunnel did not attach in ${ATTACH_TIMEOUT_MS / 1000}s. Another process may use the tunnel ID ${route}`))
  connection = attached

  process.stdout.write(
    `\nLocal:  http://${host}:${port}\nTunnel: ${url}\n` +
      `Agents: validate with the Local URL (playwriter, curl), it is much faster. The Tunnel URL is for the user.\n\n`,
  )

  void (async () => {
    for await (const event of attached.events) {
      if (event.type === 'disconnected') log(`Tunnel disconnected: ${event.reason}`)
      if (event.type === 'connected') log('Tunnel connected')
    }
  })()

  const closed = await attached.closed.then(() => undefined, (cause: unknown) => new Error('Tunnel stopped', { cause }))
  return fail(closed ?? new Error('Tunnel stopped'))
}
