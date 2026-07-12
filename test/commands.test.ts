import test from 'node:test'
import assert from 'node:assert/strict'
import { doctor } from '../src/commands.js'
import type { RuntimeConfig } from '../src/config.js'

const baseConfig: RuntimeConfig = {
  baseUrl: 'https://risk.example',
  token: 'token-1',
  tokenSource: 'config',
  configPath: '/tmp/risk-cli-config.json',
}

test('doctor 默认不请求模型、应用或名单列表', async () => {
  const requested: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = toUrl(input)
    requested.push(url)
    if (url === 'https://risk.example') {
      return new Response('', { status: 200 })
    }
    if (url === 'https://risk.example/services/v1/auth/session/check') {
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }
  try {
    const result = await doctor(baseConfig)
    assert.equal(result.full, false)
    assert.equal(result.authReachable, true)
    assert.deepEqual(requested, [
      'https://risk.example',
      'https://risk.example/services/v1/auth/session/check',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('doctor --full 检查模型、应用和每个模型的名单列表', async () => {
  const requested: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = toUrl(input)
    requested.push(url)
    if (url === 'https://risk.example') {
      return new Response('', { status: 200 })
    }
    if (url === 'https://risk.example/services/v1/auth/session/check') {
      return new Response(null, { status: 204 })
    }
    if (url === 'https://risk.example/services/v1/model/list') {
      return Response.json({
        success: true,
        data: {
          modelList: [
            { id: 1, name: 'model-a' },
            { id: 2, name: 'model-b' },
          ],
        },
      })
    }
    if (url === 'https://risk.example/services/v1/app/list') {
      return Response.json({ success: true, data: { list: [{ id: 9 }] } })
    }
    if (url === 'https://risk.example/services/v1/datalist/list/1') {
      return Response.json({ success: true, data: { list: [{ id: 11 }] } })
    }
    if (url === 'https://risk.example/services/v1/datalist/list/2') {
      return Response.json({ success: true, data: { list: [] } })
    }
    return new Response(JSON.stringify({ success: false, msg: `未预期请求: ${url}` }), { status: 500 })
  }
  try {
    const result = await doctor(baseConfig, { full: true })
    const fullChecks = result.fullChecks as {
      models: { count: number }
      apps: { count: number }
      dataLists: { checkedModels: number; totalCount: number }
    }
    assert.equal(result.full, true)
    assert.equal(fullChecks.models.count, 2)
    assert.equal(fullChecks.apps.count, 1)
    assert.equal(fullChecks.dataLists.checkedModels, 2)
    assert.equal(fullChecks.dataLists.totalCount, 1)
    assert.ok(requested.includes('https://risk.example/services/v1/model/list'))
    assert.ok(requested.includes('https://risk.example/services/v1/app/list'))
    assert.ok(requested.includes('https://risk.example/services/v1/datalist/list/1'))
    assert.ok(requested.includes('https://risk.example/services/v1/datalist/list/2'))
  } finally {
    globalThis.fetch = originalFetch
  }
})

function toUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url
  return String(input)
}
