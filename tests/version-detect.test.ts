import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import axios from 'axios'
import { detectBackendTypeOnly, detectBackendWithVersion, detectBackendWithVersionAuth } from '../src/adapter/detect.ts'
import { transClient } from '../src/api/trans-client.ts'

test('version detection: detectBackendWithVersion parses qBittorrent version', async () => {
  const detector = {
    get: async (url: string) => {
      if (url === '/api/v2/app/version') return { status: 200, data: '5.0.4' }
      if (url === '/api/v2/app/webapiVersion') return { status: 200, data: '2.11.0' }
      return { status: 404, data: '' }
    },
    post: async () => ({ status: 404, data: {} }),
  }

  try {
    mock.method(axios as any, 'create', () => detector as any)
    const v = await detectBackendWithVersion(1000)
    assert.equal(v.type, 'qbit')
    assert.equal(v.version, '5.0.4')
    assert.equal(v.major, 5)
    assert.equal(v.minor, 0)
    assert.equal(v.patch, 4)
    assert.equal(v.apiVersion, '2.11.0')
  } finally {
    mock.restoreAll()
  }
})

test('version detection: detectBackendWithVersion retries Transmission 409 and extracts rpcSemver', async () => {
  let postCalls = 0
  const detector = {
    get: async () => ({ status: 404, data: '' }),
    post: async (_url: string, _payload: any, config?: any) => {
      postCalls++

      if (postCalls === 1) {
        return {
          status: 409,
          data: {},
          headers: {
            'x-transmission-session-id': 'SID',
            'x-transmission-rpc-version': '6.0.0',
          },
        }
      }

      assert.equal(config?.headers?.['X-Transmission-Session-Id'], 'SID')
      return {
        status: 200,
        data: {
          arguments: {
            version: '4.1.0',
            'rpc-version-semver': '6.0.0',
          },
          result: 'success',
        },
        headers: {},
      }
    },
  }

  try {
    mock.method(axios as any, 'create', () => detector as any)
    const v = await detectBackendWithVersion(1000)
    assert.equal(v.type, 'trans')
    assert.equal(v.version, '4.1.0')
    assert.equal(v.major, 4)
    assert.equal(v.minor, 1)
    assert.equal(v.patch, 0)
    assert.equal(v.rpcSemver, '6.0.0')
    assert.equal(v.isUnknown, false)
  } finally {
    mock.restoreAll()
  }
})

test('version detection: Transmission 409 without Session-Id still returns rpcSemver header (unknown version)', async () => {
  const detector = {
    get: async () => ({ status: 404, data: '' }),
    post: async () => ({
      status: 409,
      data: {},
      headers: {
        'x-transmission-rpc-version': '6.0.0',
      },
    }),
  }

  try {
    mock.method(axios as any, 'create', () => detector as any)
    const v = await detectBackendWithVersion(1000)
    assert.equal(v.type, 'trans')
    assert.equal(v.version, 'unknown')
    assert.equal(v.rpcSemver, '6.0.0')
    assert.equal(v.isUnknown, true)
  } finally {
    mock.restoreAll()
  }
})

test('version detection: Transmission 401 (Basic Auth) with X-Transmission-Session-Id is detected as Transmission (unknown version)', async () => {
  const detector = {
    get: async () => ({ status: 404, data: '' }),
    post: async () => ({
      status: 401,
      data: {},
      headers: {
        'x-transmission-session-id': 'sid',
      },
    }),
  }

  try {
    mock.method(axios as any, 'create', () => detector as any)
    const v = await detectBackendWithVersion(1000)
    assert.equal(v.type, 'trans')
    assert.equal(v.version, 'unknown')
    assert.equal(v.major, 0)
    assert.equal(v.minor, 0)
    assert.equal(v.patch, 0)
    assert.equal(v.isUnknown, true)
  } finally {
    mock.restoreAll()
  }
})

test('version detection: Transmission 401 (Basic Auth) with WWW-Authenticate Transmission realm is detected as Transmission (unknown version)', async () => {
  const detector = {
    get: async () => ({ status: 404, data: '' }),
    post: async () => ({
      status: 401,
      data: {},
      headers: {
        'www-authenticate': 'Basic realm=\"Transmission\"',
      },
    }),
  }

  try {
    mock.method(axios as any, 'create', () => detector as any)
    const v = await detectBackendWithVersion(1000)
    assert.equal(v.type, 'trans')
    assert.equal(v.version, 'unknown')
    assert.equal(v.major, 0)
    assert.equal(v.minor, 0)
    assert.equal(v.patch, 0)
    assert.equal(v.isUnknown, true)
  } finally {
    mock.restoreAll()
  }
})

test('version detection: generic 401 without Transmission headers should not be detected as Transmission', async () => {
  const detector = {
    get: async () => ({ status: 401, data: '', headers: {} }),
    post: async () => ({
      status: 401,
      data: {},
      headers: { 'www-authenticate': 'Basic realm=\"Restricted\"' },
    }),
  }

  try {
    mock.method(axios as any, 'create', () => detector as any)
    const v = await detectBackendWithVersion(1000)
    assert.equal(v.type, 'qbit')
    assert.equal(v.version, 'unknown')
    assert.equal(v.isUnknown, true)
  } finally {
    mock.restoreAll()
  }
})

test('version detection: detectBackendWithVersionAuth does not default unknown Transmission to 4.0.0', async () => {
  const prev = process.env.VITE_BACKEND_TYPE
  process.env.VITE_BACKEND_TYPE = 'trans'

  try {
    mock.method(transClient as any, 'post', async () => ({
      data: {
        arguments: {
          version: 'unknown',
          'rpc-version-semver': '6.0.0',
        },
      },
    }))

    const v = await detectBackendWithVersionAuth(1000)
    assert.equal(v.type, 'trans')
    assert.equal(v.version, 'unknown')
    assert.equal(v.major, 0)
    assert.equal(v.minor, 0)
    assert.equal(v.patch, 0)
    assert.equal(v.rpcSemver, '6.0.0')
    assert.equal(v.isUnknown, true)
  } finally {
    if (prev === undefined) delete process.env.VITE_BACKEND_TYPE
    else process.env.VITE_BACKEND_TYPE = prev
    mock.restoreAll()
  }
})

test('version detection: VITE_TR_URL makes type detection return Transmission without probing', async () => {
  const prev = process.env.VITE_TR_URL
  process.env.VITE_TR_URL = 'http://localhost:9091/transmission/rpc'

  let createCalled = 0
  mock.method(axios as any, 'create', () => {
    createCalled++
    throw new Error('axios.create should not be called when VITE_TR_URL is set')
  })

  try {
    const type = await detectBackendTypeOnly(1000)
    assert.equal(type, 'trans')
    assert.equal(createCalled, 0)
  } finally {
    if (prev === undefined) delete process.env.VITE_TR_URL
    else process.env.VITE_TR_URL = prev
    mock.restoreAll()
  }
})

test('version detection: VITE_TR_URL skips unauthenticated Transmission version probing', async () => {
  const prev = process.env.VITE_TR_URL
  process.env.VITE_TR_URL = 'http://localhost:9091/transmission/rpc'

  let createCalled = 0
  mock.method(axios as any, 'create', () => {
    createCalled++
    throw new Error('axios.create should not be called when VITE_TR_URL is set')
  })

  try {
    const v = await detectBackendWithVersion(1000)
    assert.equal(v.type, 'trans')
    assert.equal(v.version, 'unknown')
    assert.equal(v.major, 0)
    assert.equal(v.isUnknown, true)
    assert.equal(createCalled, 0)
  } finally {
    if (prev === undefined) delete process.env.VITE_TR_URL
    else process.env.VITE_TR_URL = prev
    mock.restoreAll()
  }
})
