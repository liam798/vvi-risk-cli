import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requestJson } from '../src/http.js'
import { readConfigFile, writeConfigFile, type RuntimeConfig } from '../src/config.js'

test('requestJson 在业务请求前续签 token 并写回配置文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'risk-cli-token-refresh-'))
  const configPath = join(dir, 'config.json')
  writeConfigFile({ baseUrl: 'https://risk.example', token: 'token-old' }, configPath)
  const config: RuntimeConfig = {
    baseUrl: 'https://risk.example',
    token: 'token-old',
    tokenSource: 'config',
    configPath,
  }
  const requested: Array<{ url: string; token: string | null }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = toUrl(input)
    const token = headerValue(init?.headers, 'x-auth-token')
    requested.push({ url, token })
    if (url === 'https://risk.example/services/v1/auth/session/check') {
      return Response.json({
        success: true,
        data: {
          'x-auth-token': 'token-new',
        },
      })
    }
    if (url === 'https://risk.example/services/v1/model/list') {
      return Response.json({ success: true, data: { modelList: [] } })
    }
    return new Response('not found', { status: 404 })
  }

  try {
    await requestJson(config, { path: '/services/v1/model/list' })

    assert.deepEqual(requested, [
      { url: 'https://risk.example/services/v1/auth/session/check', token: 'token-old' },
      { url: 'https://risk.example/services/v1/model/list', token: 'token-new' },
    ])
    assert.equal(readConfigFile(configPath).token, 'token-new')
    assert.ok(readConfigFile(configPath).tokenUpdatedAt)
  } finally {
    globalThis.fetch = originalFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

function toUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url
  return String(input)
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return found?.[1] ?? null
  }
  return headers[name] ?? null
}
