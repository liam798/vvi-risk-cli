import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type CliConfig = {
  baseUrl?: string
  token?: string
  tokenUpdatedAt?: string
}

export type RuntimeConfig = {
  baseUrl: string
  token: string | null
  tokenSource: 'flag' | 'env' | 'config' | 'missing'
  configPath: string
}

export type GlobalOptions = {
  baseUrl?: string
  token?: string
}

export function getConfigPath(): string {
  return join(homedir(), '.config', 'vvicat-risk', 'config.json')
}

export function readConfigFile(path = getConfigPath()): CliConfig {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CliConfig
  } catch {
    return {}
  }
}

export function writeConfigFile(config: CliConfig, path = getConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export function writeRuntimeToken(config: RuntimeConfig, token: string): void {
  const current = readConfigFile(config.configPath)
  writeConfigFile({
    ...current,
    baseUrl: config.baseUrl,
    token,
    tokenUpdatedAt: new Date().toISOString(),
  }, config.configPath)
}

export function resolveRuntimeConfig(options: GlobalOptions = {}): RuntimeConfig {
  const fileConfig = readConfigFile()
  const baseUrl = options.baseUrl
    ?? process.env.RISK_BASE_URL
    ?? fileConfig.baseUrl
    ?? 'http://127.0.0.1:6580'
  const flagToken = trimToNull(options.token)
  const envToken = trimToNull(process.env.RISK_ADMIN_TOKEN)
  const fileToken = trimToNull(fileConfig.token)
  const token = flagToken ?? envToken ?? fileToken ?? null
  const tokenSource = flagToken ? 'flag' : envToken ? 'env' : fileToken ? 'config' : 'missing'
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    tokenSource,
    configPath: getConfigPath(),
  }
}

function trimToNull(value?: string | null): string | null {
  const next = value?.trim()
  return next ? next : null
}
