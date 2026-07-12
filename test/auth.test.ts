import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCliLoginUrl } from '../src/auth.js'

test('buildCliLoginUrl 打开风控前端登录页并携带本地回调参数', () => {
  const url = buildCliLoginUrl('https://risk.xmfind.cn/', 'http://127.0.0.1:57629/callback', 'state-1')
  assert.equal(url, 'https://risk.xmfind.cn/#/login?cliCallback=http%3A%2F%2F127.0.0.1%3A57629%2Fcallback&cliState=state-1')
})
