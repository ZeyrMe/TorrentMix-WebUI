import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import axios from 'axios'
import { detectBackendTypeOnly, detectBackendWithVersion } from '../src/adapter/detect.ts'

test('backend detection: VITE_TR_URL selects Transmission without unauthenticated probing', async () => {
  const prev = process.env.VITE_TR_URL
  process.env.VITE_TR_URL = 'https://example.com/transmission/rpc'

  let createCalled = 0

  try {
    mock.method(axios as any, 'create', () => {
      createCalled++
      throw new Error('axios.create should not be called when VITE_TR_URL is set')
    })

    const v = await detectBackendWithVersion(1000)
    assert.equal(v.type, 'trans')
    assert.equal(v.version, 'unknown')
    assert.equal(v.isUnknown, true)

    const type = await detectBackendTypeOnly(1000)
    assert.equal(type, 'trans')
    assert.equal(createCalled, 0)
  } finally {
    if (prev === undefined) delete process.env.VITE_TR_URL
    else process.env.VITE_TR_URL = prev
    mock.restoreAll()
  }
})
