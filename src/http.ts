import { CliError } from './output.js'
import { writeRuntimeToken, type RuntimeConfig } from './config.js'

type RequestOptions = {
  method?: string
  path: string
  body?: unknown
  requireAuth?: boolean
  allowWrite?: boolean
}

const renewedTokens = new Map<string, string>()

export async function requestJson(config: RuntimeConfig, options: RequestOptions): Promise<unknown> {
  const method = (options.method ?? 'GET').toUpperCase()
  const path = normalizePath(options.path)
  if (!options.allowWrite && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new CliError(`拒绝执行写请求: ${method} ${path}。如需继续，请显式传入 --allow-write。`)
  }
  if ((options.requireAuth ?? true) && !config.token) {
    throw new CliError('缺少 x-auth-token，请先执行 risk-cli login；如需脚本环境兼容，也可以设置 RISK_ADMIN_TOKEN 或执行 risk-cli init --token。', { code: 'AUTH_MISSING' })
  }
  const runtimeConfig = (options.requireAuth ?? true) && config.token && path !== '/services/v1/auth/session/check'
    ? await renewSession(config)
    : config
  const url = `${runtimeConfig.baseUrl}${path}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (runtimeConfig.token) headers['x-auth-token'] = runtimeConfig.token
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  const text = await response.text()
  const parsed = tryParseJson(text)
  if (!response.ok) {
    throwAuthAwareError(extractMessage(parsed) ?? `HTTP ${response.status} ${method} ${path}`, parsed, response.status)
  }
  if (parsed && typeof parsed === 'object' && 'success' in parsed) {
    const result = parsed as { success?: boolean; code?: string; msg?: string; message?: string }
    if (result.success === false) {
      throwAuthAwareError(result.msg ?? result.message ?? '请求失败', result, response.status)
    }
  }
  persistRenewedToken(runtimeConfig, parsed)
  return parsed ?? text
}

async function renewSession(config: RuntimeConfig): Promise<RuntimeConfig> {
  const cacheKey = `${config.baseUrl}\n${config.token ?? ''}`
  const cachedToken = renewedTokens.get(cacheKey)
  if (cachedToken) {
    return {
      ...config,
      token: cachedToken,
    }
  }
  const response = await fetch(`${config.baseUrl}/services/v1/auth/session/check`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-auth-token': config.token ?? '',
    },
  })
  const text = await response.text()
  const parsed = tryParseJson(text)
  if (!response.ok) {
    throwAuthAwareError(extractMessage(parsed) ?? 'CLI 登录已过期', parsed, response.status)
  }
  const nextToken = extractToken(parsed)
  if (!nextToken || nextToken === config.token) {
    renewedTokens.set(cacheKey, config.token ?? '')
    return config
  }
  if (config.tokenSource === 'config') {
    writeRuntimeToken(config, nextToken)
  }
  renewedTokens.set(cacheKey, nextToken)
  return {
    ...config,
    token: nextToken,
  }
}

function persistRenewedToken(config: RuntimeConfig, payload: unknown): void {
  if (config.tokenSource !== 'config') return
  const nextToken = extractToken(payload)
  if (!nextToken || nextToken === config.token) return
  writeRuntimeToken(config, nextToken)
}

function extractToken(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as Record<string, unknown>).data
  if (!data || typeof data !== 'object') return null
  const token = (data as Record<string, unknown>)['x-auth-token']
  return typeof token === 'string' && token.trim() ? token.trim() : null
}

function throwAuthAwareError(message: string, payload: unknown, status?: number): never {
  const code = extractCode(payload)
  if (status === 401 || code === '601' || code === '602' || code === '603') {
    throw new CliError(`${message}；请重新执行 risk-cli login。`, { code: code ?? 'AUTH_EXPIRED', status })
  }
  throw new CliError(message, { code: code ?? undefined, status })
}

function extractCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const code = (value as Record<string, unknown>).code
  return typeof code === 'string' && code.trim() ? code.trim() : null
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function tryParseJson(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function extractMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const candidate = record.msg ?? record.message ?? record.error
  if (typeof candidate !== 'string' || !candidate.trim()) return null
  const path = typeof record.path === 'string' && record.path.trim() ? `: ${record.path}` : ''
  return `${candidate}${path}`
}
