import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { sanitizeOutboundHeaders } from '../net-headers.mjs'

describe('sanitizeOutboundHeaders', () => {
  // 署名付き PUT の headers には Content-Length が入る。Chromium は呼び出し側からの
  // 指定を拒否して net::ERR_INVALID_ARGUMENT になるため、必ず落とす。本文から
  // ネットワークスタックが同じ値を付け直すので、SigV4 の署名は一致したままになる。
  it('drops Content-Length so net.fetch does not reject the request', () => {
    assert.deepEqual(
      sanitizeOutboundHeaders({ 'Content-Type': 'image/png', 'Content-Length': '6' }),
      { 'Content-Type': 'image/png' },
    )
  })

  it('drops forbidden header names regardless of case', () => {
    assert.deepEqual(
      sanitizeOutboundHeaders({ 'content-length': '6', HOST: 'example.com', 'Content-Type': 'image/png' }),
      { 'Content-Type': 'image/png' },
    )
  })

  // ブラウザの XHR / fetch が黙って捨てるヘッダと同じ集合を落とす。レンダラが
  // どの経路を通っても、ストレージが受け取るヘッダが同じになるようにする。
  it('drops the other headers browsers refuse to let callers set', () => {
    assert.deepEqual(
      sanitizeOutboundHeaders({
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
        Host: 'example.com',
        Origin: 'app://localhost',
        Referer: 'app://localhost/',
        Cookie: 'a=1',
        'Proxy-Authorization': 'Basic x',
        'Sec-Fetch-Mode': 'cors',
      }),
      {},
    )
  })

  it('keeps headers the network stack does not manage', () => {
    assert.deepEqual(
      sanitizeOutboundHeaders({
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'x-amz-acl': 'private',
      }),
      { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'x-amz-acl': 'private' },
    )
  })

  it('returns an empty object when no headers are given', () => {
    assert.deepEqual(sanitizeOutboundHeaders(undefined), {})
    assert.deepEqual(sanitizeOutboundHeaders(null), {})
  })
})
