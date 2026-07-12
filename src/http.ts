import { CliError } from './output.js'
import type { RuntimeConfig } from './config.js'

type RequestOptions = {
  method?: string
  path: string
  body?: unknown
  requireAuth?: boolean
  allowWrite?: boolean
}

export async function requestJson(config: RuntimeConfig, options: RequestOptions): Promise<unknown> {
  const method = (options.method ?? 'GET').toUpperCase()
  if (!options.allowWrite && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new CliError(`拒绝执行写请求: ${method} ${options.path}。如需继续，请显式传入 --allow-write。`)
  }
  if ((options.requireAuth ?? true) && !config.token) {
    throw new CliError('缺少 x-auth-token，请先执行 risk-cli login；如需脚本环境兼容，也可以设置 RISK_ADMIN_TOKEN 或执行 risk-cli init --token。', { code: 'AUTH_MISSING' })
  }
  const url = `${config.baseUrl}${normalizePath(options.path)}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (config.token) headers['x-auth-token'] = config.token
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  const text = await response.text()
  const parsed = tryParseJson(text)
  if (!response.ok) {
    throw new CliError(extractMessage(parsed) ?? `HTTP ${response.status} ${method} ${normalizePath(options.path)}`, { status: response.status })
  }
  if (parsed && typeof parsed === 'object' && 'success' in parsed) {
    const result = parsed as { success?: boolean; code?: string; msg?: string; message?: string }
    if (result.success === false) {
      throw new CliError(result.msg ?? result.message ?? '请求失败', { code: result.code, status: response.status })
    }
  }
  return parsed ?? text
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
