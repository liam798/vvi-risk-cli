import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getConfigPath, readConfigFile, resolveRuntimeConfig, writeConfigFile } from '../src/config.js'

test('resolveRuntimeConfig 使用 RISK_BASE_URL 和 RISK_ADMIN_TOKEN 优先于默认值', () => {
  process.env.RISK_BASE_URL = 'http://risk.example'
  process.env.RISK_ADMIN_TOKEN = 'abc'
  const config = resolveRuntimeConfig()
  assert.equal(config.baseUrl, 'http://risk.example')
  assert.equal(config.token, 'abc')
  assert.equal(config.tokenSource, 'env')
  delete process.env.RISK_BASE_URL
  delete process.env.RISK_ADMIN_TOKEN
})

test('getConfigPath 使用 XDG 风格 vvicat-risk 配置目录', () => {
  assert.equal(getConfigPath(), join(process.env.HOME ?? '', '.config', 'vvicat-risk', 'config.json'))
})

test('readConfigFile 和 writeConfigFile 读写 baseUrl 与 token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'risk-cli-config-'))
  const path = join(dir, 'config.json')
  try {
    writeConfigFile({ baseUrl: 'https://risk.example', token: 'token-1' }, path)
    assert.deepEqual(readConfigFile(path), {
      baseUrl: 'https://risk.example',
      token: 'token-1',
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
