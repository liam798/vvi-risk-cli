import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getConfigPath, type RuntimeConfig, writeRuntimeToken } from './config.js'
import { CliError } from './output.js'

type LoginOptions = {
  port?: number
  timeoutSeconds: number
  openBrowser: boolean
}

type LoginPayload = {
  token?: string
  username?: string
  code?: string
  activeTenantId?: number | null
  activeTenantCode?: string
  authProvider?: string
}

export async function loginWithMemHub(config: RuntimeConfig, options: LoginOptions): Promise<Record<string, unknown>> {
  const cliState = randomBytes(24).toString('base64url')
  const callback = await createCallbackServer(options.timeoutSeconds, cliState, options.port)
  try {
    const authorizeUrl = buildCliLoginUrl(config.baseUrl, callback.url, cliState)
    if (options.openBrowser) {
      openBrowser(authorizeUrl)
    }
    const loginResult = await callback.waitForLogin(authorizeUrl)
    const token = loginResult.token?.trim()
    if (!token) {
      throw new CliError('MemHub 登录成功但未返回 token', { code: 'OAUTH_TOKEN_MISSING' })
    }
    writeRuntimeToken(config, token)
    return {
      configPath: getConfigPath(),
      username: loginResult.username ?? null,
      code: loginResult.code ?? null,
      activeTenantId: loginResult.activeTenantId ?? null,
      activeTenantCode: loginResult.activeTenantCode ?? null,
      authProvider: loginResult.authProvider ?? 'MEMHUB',
      tokenConfigured: true,
    }
  } finally {
    await callback.close()
  }
}

export function buildCliLoginUrl(baseUrl: string, callbackUrl: string, cliState: string): string {
  const url = new URL(baseUrl.replace(/\/+$/, '') + '/')
  const query = new URLSearchParams({
    cliCallback: callbackUrl,
    cliState,
  })
  url.hash = `/login?${query.toString()}`
  return url.toString()
}

function createCallbackServer(timeoutSeconds: number, expectedState: string, port?: number): Promise<{
  url: string
  waitForLogin: (authorizeUrl: string) => Promise<LoginPayload>
  close: () => Promise<void>
}> {
  return new Promise((resolve, reject) => {
    let settled = false
    let completeLogin: ((payload: LoginPayload) => void) | null = null
    let failLogin: ((error: Error) => void) | null = null

    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
      try {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (requestUrl.pathname !== '/callback') {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('Not found')
          return
        }
        const payload = await readLoginPayload(request, requestUrl)
        if (!safeEqual(payload.cliState, expectedState)) {
          throw new CliError('CLI 登录状态校验失败，请重新执行 risk-cli login', { code: 'OAUTH_CALLBACK_INVALID' })
        }
        const token = payload.token?.trim()
        if (!token) {
          throw new CliError('风控平台回调缺少 token', { code: 'OAUTH_TOKEN_MISSING' })
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(successPage())
        completeLogin?.(payload)
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(errorPage(error instanceof Error ? error.message : String(error)))
        failLogin?.(error instanceof Error ? error : new Error(String(error)))
      }
    })

    server.once('error', reject)
    server.listen(port ?? 0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      const callbackUrl = `http://127.0.0.1:${address.port}/callback`
      resolve({
        url: callbackUrl,
        waitForLogin: (authorizeUrl: string) => new Promise<LoginPayload>((resolveLogin, rejectLogin) => {
          completeLogin = resolveLogin
          failLogin = rejectLogin
          process.stderr.write(`请在浏览器中完成登录：${authorizeUrl}\n`)
          const timer = setTimeout(() => {
            if (!settled) {
              settled = true
              rejectLogin(new CliError('等待 OAuth 登录超时', { code: 'OAUTH_TIMEOUT' }))
            }
          }, timeoutSeconds * 1000)
          const wrapResolve = completeLogin
          completeLogin = (payload) => {
            if (!settled) {
              settled = true
              clearTimeout(timer)
              wrapResolve(payload)
            }
          }
          const wrapReject = failLogin
          failLogin = (error) => {
            if (!settled) {
              settled = true
              clearTimeout(timer)
              wrapReject(error)
            }
          }
        }),
        close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
      })
    })
  })
}

async function readLoginPayload(request: IncomingMessage, requestUrl: URL): Promise<LoginPayload & { cliState?: string }> {
  if (request.method === 'POST') {
    const body = await readBody(request)
    const params = new URLSearchParams(body)
    return Object.fromEntries(params.entries())
  }
  return Object.fromEntries(requestUrl.searchParams.entries())
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      if (Buffer.concat(chunks).byteLength > 1024 * 1024) {
        reject(new CliError('CLI 登录回调体过大', { code: 'OAUTH_CALLBACK_INVALID' }))
        request.destroy()
      }
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function safeEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { stdio: 'ignore', detached: true })
  child.unref()
}

function successPage(): string {
  return '<!doctype html><meta charset="utf-8"><title>登录成功</title><body><h1>登录成功</h1><p>risk-cli 已保存登录状态，可以关闭此页面。</p></body>'
}

function errorPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>登录失败</title><body><h1>登录失败</h1><p>${escapeHtml(message)}</p></body>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char))
}
