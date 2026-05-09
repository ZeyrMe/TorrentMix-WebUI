import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import { clearTransSessionAuth, clearTransSessionId, restoreTransSessionAuth, transClient } from '../src/api/trans-client.ts'
import { TransAdapter } from '../src/adapter/trans/index.ts'
import { VIRTUAL_ROOT_EXTERNAL_PREFIX } from '../src/utils/folderTree.ts'

function createFakeStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key)
    },
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  } as Storage
}

function installSessionStorage(storage = createFakeStorage()): () => void {
  const g = globalThis as typeof globalThis & { window?: any }
  const originalWindow = g.window
  g.window = { ...(originalWindow ?? {}), sessionStorage: storage }

  return () => {
    if (originalWindow === undefined) {
      delete g.window
    } else {
      g.window = originalWindow
    }
  }
}

test('Transmission: checkSession should succeed without Basic Auth when backend is open', async () => {
  const adapter = new TransAdapter()
  const originalAuth = transClient.defaults.auth

  try {
    transClient.defaults.auth = undefined

    let calls = 0
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      calls++
      assert.equal(payload.method, 'session-get')
      return {
        data: {
          result: 'success',
          arguments: {},
        },
      }
    })

    const ok = await adapter.checkSession()
    assert.equal(ok, true)
    assert.equal(calls, 1)
  } finally {
    transClient.defaults.auth = originalAuth
    mock.restoreAll()
  }
})

test('Transmission: login should trim Basic Auth credentials', async () => {
  const adapter = new TransAdapter()
  const originalAuth = transClient.defaults.auth

  try {
    transClient.defaults.auth = undefined

    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.method, 'session-get')
      assert.deepEqual(transClient.defaults.auth, { username: 'admin', password: 'pass' })
      return {
        data: {
          result: 'success',
          arguments: {},
        },
      }
    })

    await adapter.login('  admin  ', '  pass  ')
    assert.deepEqual(transClient.defaults.auth, { username: 'admin', password: 'pass' })
  } finally {
    transClient.defaults.auth = originalAuth
    mock.restoreAll()
  }
})

test('Transmission: login should persist Basic Auth in sessionStorage for refresh restore', async () => {
  const restoreWindow = installSessionStorage()
  const adapter = new TransAdapter()
  const originalAuth = transClient.defaults.auth

  try {
    clearTransSessionAuth()

    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.method, 'session-get')
      return {
        data: {
          result: 'success',
          arguments: {},
        },
      }
    })

    await adapter.login('  admin  ', '  pass  ')
    assert.deepEqual(transClient.defaults.auth, { username: 'admin', password: 'pass' })

    transClient.defaults.auth = undefined
    clearTransSessionId()

    assert.equal(restoreTransSessionAuth(), true)
    assert.deepEqual(transClient.defaults.auth, { username: 'admin', password: 'pass' })
  } finally {
    mock.restoreAll()
    clearTransSessionAuth()
    transClient.defaults.auth = originalAuth
    restoreWindow()
  }
})

test('Transmission: failed login should clear temporary Basic Auth and stored credentials', async () => {
  const restoreWindow = installSessionStorage()
  const adapter = new TransAdapter()
  const originalAuth = transClient.defaults.auth

  try {
    clearTransSessionAuth()

    mock.method(transClient as any, 'post', async () => {
      throw new Error('Unauthorized')
    })

    await assert.rejects(() => adapter.login('admin', 'bad-pass'), /Unauthorized/)
    assert.equal(transClient.defaults.auth, undefined)
    assert.equal(restoreTransSessionAuth(), false)
  } finally {
    mock.restoreAll()
    clearTransSessionAuth()
    transClient.defaults.auth = originalAuth
    restoreWindow()
  }
})

test('Transmission: logout should clear persisted Basic Auth and cached session id', async () => {
  const restoreWindow = installSessionStorage()
  const adapter = new TransAdapter()
  const originalAuth = transClient.defaults.auth

  try {
    clearTransSessionAuth()

    mock.method(transClient as any, 'post', async () => ({
      data: {
        result: 'success',
        arguments: {},
      },
    }))

    await adapter.login('admin', 'pass')
    transClient.defaults.headers['X-Transmission-Session-Id'] = 'sid'
    await adapter.logout()

    assert.equal(transClient.defaults.auth, undefined)
    assert.equal((transClient.defaults.headers as any)['X-Transmission-Session-Id'], undefined)
    assert.equal(restoreTransSessionAuth(), false)
  } finally {
    mock.restoreAll()
    clearTransSessionAuth()
    transClient.defaults.auth = originalAuth
    restoreWindow()
  }
})

test('Transmission: checkSession should return false when unauthorized', async () => {
  const adapter = new TransAdapter()
  const originalAuth = transClient.defaults.auth

  try {
    transClient.defaults.auth = undefined

    let calls = 0
    mock.method(transClient as any, 'post', async () => {
      calls++
      throw new Error('Unauthorized')
    })

    const ok = await adapter.checkSession()
    assert.equal(ok, false)
    assert.equal(calls, 1)
  } finally {
    transClient.defaults.auth = originalAuth
    mock.restoreAll()
  }
})

test('Transmission legacy: fetchList should map torrent list + labels + trackerStats', async () => {
  const adapter = new TransAdapter()

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      if (payload.method === 'session-get') {
        return {
          data: {
            result: 'success',
            arguments: {
              units: { 'speed-bytes': 1000 },
              'download-dir': '/d',
              'speed-limit-down-enabled': true,
              'speed-limit-down': 111,
              'speed-limit-up-enabled': true,
              'speed-limit-up': 222,
              'alt-speed-enabled': true,
              'alt-speed-down': 5,
              'alt-speed-up': 6,
            },
          },
        }
      }

      assert.equal(payload.method, 'torrent-get')
      assert.ok(Array.isArray(payload.arguments?.fields))
      assert.ok(payload.arguments.fields.includes('hashString'))
      assert.ok(payload.arguments.fields.includes('trackerStats'))
      assert.ok(payload.arguments.fields.includes('labels'))

      return {
        data: {
          result: 'success',
          arguments: {
            torrents: [
              {
                hashString: 'h1',
                name: 'T1',
                status: 4,
                error: 0,
                percentDone: 0.5,
                totalSize: 100,
                rateDownload: 10,
                rateUpload: 20,
                eta: 60,
                uploadRatio: 0.1,
                addedDate: 1,
                downloadDir: '/d/movies/action',
                labels: ['t2', 't3'],
                trackerStats: [{ seederCount: 7, leecherCount: 8 }],
              },
            ],
          },
        },
      }
    })

    const res = await adapter.fetchList()
    const t = res.torrents.get('h1')!
    assert.equal(t.id, 'h1')
    assert.equal(t.name, 'T1')
    assert.equal(t.state, 'downloading')
    assert.equal(t.category, 'movies/action')
    assert.deepEqual(t.tags, ['t2', 't3'])
    assert.equal(res.categories.get('movies/action')?.savePath, '')
    assert.deepEqual(res.tags, ['t2', 't3'])
    assert.equal(t.totalSeeds, 7)
    assert.equal(t.totalPeers, 8)

    assert.equal(res.serverState?.backendName, 'Transmission')
    assert.equal(res.serverState?.connectionStatus, 'connected')
    assert.equal(res.serverState?.dlInfoSpeed, 10)
    assert.equal(res.serverState?.upInfoSpeed, 20)
    assert.equal(res.serverState?.useAltSpeed, true)
    assert.equal(res.serverState?.altDlLimit, 5000)
    assert.equal(res.serverState?.altUpLimit, 6000)
    assert.equal(res.serverState?.dlRateLimit, 5000)
    assert.equal(res.serverState?.upRateLimit, 6000)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: fetchList should map torrent list + labels + tracker_stats', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')
        if (payload.method === 'session_get') {
          return {
            status: 200,
            data: {
              jsonrpc: '2.0',
              id: payload.id,
              result: {
                units: { speed_bytes: 1000 },
                download_dir: '/z',
                speed_limit_down_enabled: true,
                speed_limit_down: 7,
                speed_limit_up_enabled: false,
                speed_limit_up: 9,
                alt_speed_enabled: false,
                alt_speed_down: 3,
                alt_speed_up: 4,
              },
            },
          }
        }
      assert.equal(payload.method, 'torrent_get')
      assert.ok(Array.isArray(payload.params?.fields))
      assert.ok(payload.params.fields.includes('hash_string'))
      assert.ok(payload.params.fields.includes('tracker_stats'))
      assert.ok(payload.params.fields.includes('labels'))

      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            torrents: [
              {
                hash_string: 'h4',
                name: 'T4',
                status: 4,
                error: 0,
                percent_done: 0.25,
                total_size: 400,
                rate_download: 11,
                rate_upload: 22,
                eta: 120,
                upload_ratio: 1.2,
                added_date: 3,
                download_dir: '/x',
                labels: ['tagY', 'tagZ'],
                tracker_stats: [{ seeder_count: 9, leecher_count: 10 }],
              },
            ],
          },
        },
      }
    })

    const res = await adapter.fetchList()
    const t = res.torrents.get('h4')!
    assert.equal(t.id, 'h4')
    assert.equal(t.name, 'T4')
    assert.equal(t.state, 'downloading')
    assert.equal(t.progress, 0.25)
    assert.equal(t.size, 400)
    assert.equal(t.dlspeed, 11)
    assert.equal(t.upspeed, 22)
    assert.equal(t.eta, 120)
    assert.equal(t.ratio, 1.2)
    assert.equal(t.addedTime, 3)
    assert.equal(t.savePath, '/x')
    assert.equal(t.category, `${VIRTUAL_ROOT_EXTERNAL_PREFIX}x`)
    assert.deepEqual(t.tags, ['tagY', 'tagZ'])
    assert.equal(res.categories.get(`${VIRTUAL_ROOT_EXTERNAL_PREFIX}x`)?.savePath, '')
    assert.deepEqual(res.tags, ['tagY', 'tagZ'])
    assert.equal(t.totalSeeds, 9)
    assert.equal(t.totalPeers, 10)
    assert.equal(t.numSeeds, 9)
    assert.equal(t.numPeers, 10)

    assert.equal(res.serverState?.backendName, 'Transmission')
    assert.equal(res.serverState?.connectionStatus, 'connected')
    assert.equal(res.serverState?.dlInfoSpeed, 11)
    assert.equal(res.serverState?.upInfoSpeed, 22)
    assert.equal(res.serverState?.useAltSpeed, false)
    assert.equal(res.serverState?.altDlLimit, 3000)
    assert.equal(res.serverState?.altUpLimit, 4000)
    assert.equal(res.serverState?.dlRateLimit, 7000)
    assert.equal(res.serverState?.upRateLimit, 0)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: fetchList should reuse transfer settings cache within TTL', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  let sessionGetCalls = 0
  let torrentGetCalls = 0

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')

      if (payload.method === 'session_get') {
        sessionGetCalls++
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              units: { speed_bytes: 1000 },
              download_dir: '/z',
              speed_limit_down_enabled: true,
              speed_limit_down: 7,
              speed_limit_up_enabled: true,
              speed_limit_up: 8,
              alt_speed_enabled: false,
              alt_speed_down: 0,
              alt_speed_up: 0,
            },
          },
        }
      }

      assert.equal(payload.method, 'torrent_get')
      torrentGetCalls++

      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            torrents: [
              {
                hash_string: 'h1',
                name: 'T1',
                status: 4,
                error: 0,
                percent_done: 0,
                total_size: 1,
                rate_download: 1,
                rate_upload: 2,
                eta: 0,
                upload_ratio: 0,
                added_date: 1,
                download_dir: '/z',
                labels: [],
                tracker_stats: [],
              },
            ],
          },
        },
      }
    })

    const res1 = await adapter.fetchList()
    const res2 = await adapter.fetchList()

    assert.equal(sessionGetCalls, 1)
    assert.equal(torrentGetCalls, 2)

    assert.equal(res1.serverState?.dlInfoSpeed, 1)
    assert.equal(res1.serverState?.upInfoSpeed, 2)
    assert.equal(res1.serverState?.dlRateLimit, 7000)
    assert.equal(res1.serverState?.upRateLimit, 8000)

    assert.equal(res2.serverState?.dlInfoSpeed, 1)
    assert.equal(res2.serverState?.upInfoSpeed, 2)
    assert.equal(res2.serverState?.dlRateLimit, 7000)
    assert.equal(res2.serverState?.upRateLimit, 8000)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: fetchList should treat download_dir under base case-insensitively', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')
      if (payload.method === 'session_get') {
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              units: { speed_bytes: 1000 },
              download_dir: '/Downloads',
            },
          },
        }
      }

      assert.equal(payload.method, 'torrent_get')
      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            torrents: [
              {
                hash_string: 'hc',
                name: 'TC',
                status: 4,
                error: 0,
                percent_done: 0,
                total_size: 0,
                rate_download: 0,
                rate_upload: 0,
                eta: -1,
                upload_ratio: 0,
                added_date: 0,
                download_dir: '/downloads/movies',
                labels: [],
                tracker_stats: [],
              },
            ],
          },
        },
      }
    })

    const res = await adapter.fetchList()
    const t = res.torrents.get('hc')!
    assert.equal(t.category, 'movies')
    assert.equal(res.categories.has('movies'), true)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: fetchList should retry without labels when unsupported', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  let torrentGetCalls = 0
  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')
      if (payload.method === 'session_get') {
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              units: { speed_bytes: 1000 },
              download_dir: '/d',
            },
          },
        }
      }

      assert.equal(payload.method, 'torrent_get')
      torrentGetCalls++

      if (torrentGetCalls === 1) {
        assert.ok(payload.params.fields.includes('labels'))
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            error: { code: 3, message: 'Invalid argument' },
          },
        }
      }

      assert.ok(!payload.params.fields.includes('labels'))
      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            torrents: [
              {
                hash_string: 'h5',
                name: 'T5',
                status: 0,
                error: 0,
                percent_done: 0,
                total_size: 0,
                rate_download: 0,
                rate_upload: 0,
                eta: -1,
                upload_ratio: 0,
                added_date: 0,
                download_dir: '/d',
                tracker_stats: [],
              },
            ],
          },
        },
      }
    })

    const res = await adapter.fetchList()
    const t = res.torrents.get('h5')!
    assert.equal(t.category, '')
    assert.deepEqual(t.tags, [])
    assert.equal(res.categories.size, 1)
    assert.equal(res.categories.get('')?.savePath, '/d')
    assert.deepEqual(res.tags, [])
    assert.equal(torrentGetCalls, 2)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: fetchList should keep labels enabled on transient errors', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  let torrentGetCalls = 0
  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')
      if (payload.method === 'session_get') {
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              units: { speed_bytes: 1000 },
            },
          },
        }
      }

      assert.equal(payload.method, 'torrent_get')
      torrentGetCalls++
      assert.ok(payload.params.fields.includes('labels'))

      if (torrentGetCalls === 1) {
        throw new Error('socket hang up')
      }

      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: payload.id,
          result: { torrents: [] },
        },
      }
    })

    await assert.rejects(() => adapter.fetchList(), /socket hang up/)
    await adapter.fetchList()
    assert.equal(torrentGetCalls, 2)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: fetchDetail should map files/trackers/peers and speed limits', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })
  const hash = 'h2'
  let sessionCalls = 0

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')
      if (payload.method === 'session_get') {
        sessionCalls++
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              units: { speed_bytes: 1000 },
              download_dir: '/x',
            },
          },
        }
      }
      assert.equal(payload.method, 'torrent_get')
      assert.deepEqual(payload.params?.ids, [hash])
      assert.ok(Array.isArray(payload.params?.fields))
      assert.ok(payload.params.fields.includes('hash_string'))
      assert.ok(payload.params.fields.includes('labels'))
      assert.ok(payload.params.fields.includes('tracker_stats'))

      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            torrents: [
              {
                hash_string: hash,
                name: 'T2',
                total_size: 1000,
                downloaded_ever: 200,
                uploaded_ever: 300,
                download_limited: true,
                download_limit: 12, // kB/s
                upload_limited: false,
                upload_limit: 34,
                seconds_seeding: 10,
                added_date: 1,
                done_date: 2,
                download_dir: '/x',
                labels: ['catA', 'tagB'],
                peers_connected: 2,
                peers: [
                  { address: '1.1.1.1', port: 1, client_name: 'c', progress: 1, rate_to_client: 0, rate_to_peer: 1 },
                  { address: '2.2.2.2', port: 2, client_name: 'c2', progress: 0.5, rate_to_client: 2, rate_to_peer: 0 },
                ],
                files: [
                  { name: 'a.bin', length: 100, bytes_completed: 100 },
                  { name: 'b.bin', length: 200, bytes_completed: 0 },
                ],
                priorities: [1, 0],
                wanted: [true, false],
                trackers: [{ announce: 'udp://tracker', tier: 0 }],
                tracker_stats: [{
                  announce: 'udp://tracker',
                  tier: 0,
                  announce_state: 0,
                  has_announced: true,
                  last_announce_succeeded: true,
                  last_announce_result: 'ok',
                  last_announce_peer_count: 11,
                  seeder_count: 50,
                  leecher_count: 60,
                }],
              },
            ],
          },
        },
      }
    })

    const detail = await adapter.fetchDetail(hash)
    assert.equal(detail.hash, hash)
    assert.equal(detail.name, 'T2')
    assert.equal(detail.size, 1000)
    assert.equal(detail.completed, 200)
    assert.equal(detail.uploaded, 300)
    assert.equal(detail.dlLimit, 12 * 1000)
    assert.equal(detail.upLimit, -1)
    assert.equal(detail.category, '')
    assert.deepEqual(detail.tags, ['catA', 'tagB'])
    assert.equal(detail.numSeeds, 1)
    assert.equal(detail.numLeechers, 1)
    assert.equal(detail.totalSeeds, 50)
    assert.equal(detail.totalLeechers, 60)
    assert.equal(detail.files[0]?.priority, 'high')
    assert.equal(detail.files[1]?.priority, 'do_not_download')
    assert.equal(detail.trackers[0]?.status, 'working')
    assert.equal(sessionCalls, 1)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: getTransferSettings should respect units.speed_bytes', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')
      assert.equal(payload.method, 'session_get')

      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            speed_limit_down_enabled: true,
            speed_limit_down: 10,
            speed_limit_up_enabled: false,
            speed_limit_up: 999,
            alt_speed_enabled: true,
            alt_speed_down: 1,
            alt_speed_up: 2,
            units: { speed_bytes: 1000 },
          },
        },
      }
    })

    const settings = await adapter.getTransferSettings()
    assert.equal(settings.downloadLimit, 10 * 1000)
    assert.equal(settings.uploadLimit, 0)
    assert.equal(settings.altEnabled, true)
    assert.equal(settings.altDownloadLimit, 1000)
    assert.equal(settings.altUploadLimit, 2 * 1000)
    assert.equal(settings.speedBytes, 1000)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: setTransferSettings should convert bytes/s using speedBytes', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  let phase: 'get' | 'set' = 'get'
  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')

      if (phase === 'get') {
        assert.equal(payload.method, 'session_get')
        phase = 'set'
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              speed_limit_down_enabled: true,
              speed_limit_down: 0,
              speed_limit_up_enabled: true,
              speed_limit_up: 0,
              alt_speed_enabled: false,
              alt_speed_down: 0,
              alt_speed_up: 0,
              units: { speed_bytes: 1000 },
            },
          },
        }
      }

      assert.equal(payload.method, 'session_set')
      assert.deepEqual(payload.params, {
        speed_limit_down_enabled: true,
        speed_limit_down: 5,
        speed_limit_up_enabled: false,
        speed_limit_up: 0,
        alt_speed_enabled: true,
        alt_speed_down: 2,
        alt_speed_up: 0,
      })

      return { status: 204, data: null }
    })

    // Prime speedBytes=1000
    await adapter.getTransferSettings()

    await adapter.setTransferSettings({
      downloadLimit: 5000,
      uploadLimit: 0,
      altEnabled: true,
      altDownloadLimit: 2000,
      altUploadLimit: 0,
    })
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: setDownloadLimitBatch should convert bytes/s using units.speed_bytes without preloading settings', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')

      if (payload.method === 'session_get') {
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              units: { speed_bytes: 1000 },
            },
          },
        }
      }

      assert.equal(payload.method, 'torrent_set')
      assert.deepEqual(payload.params, {
        ids: ['a'],
        download_limited: true,
        download_limit: 5,
      })

      return { status: 204, data: null }
    })

    await adapter.setDownloadLimitBatch(['a'], 5000)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission legacy: fetchList should retry without labels when unsupported', async () => {
  const adapter = new TransAdapter()

  let torrentGetCalls = 0
  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      if (payload.method === 'session-get') {
        return {
          data: {
            result: 'success',
            arguments: {
              units: { 'speed-bytes': 1000 },
              'download-dir': '/d',
            },
          },
        }
      }

      assert.equal(payload.method, 'torrent-get')
      torrentGetCalls++

      if (torrentGetCalls === 1) {
        assert.ok(payload.arguments.fields.includes('labels'))
        return { data: { result: 'invalid argument' } }
      }

      assert.ok(!payload.arguments.fields.includes('labels'))
      return {
        data: {
          result: 'success',
          arguments: {
            torrents: [
              {
                hashString: 'h3',
                name: 'T3',
                status: 0,
                error: 0,
                percentDone: 0,
                totalSize: 0,
                rateDownload: 0,
                rateUpload: 0,
                eta: -1,
                uploadRatio: 0,
                addedDate: 0,
                downloadDir: '/d',
                trackerStats: [],
              },
            ],
          },
        },
      }
    })

    const res = await adapter.fetchList()
    const t = res.torrents.get('h3')!
    assert.equal(t.category, '')
    assert.deepEqual(t.tags, [])
    assert.equal(res.categories.size, 1)
    assert.equal(res.categories.get('')?.savePath, '/d')
    assert.deepEqual(res.tags, [])
    assert.equal(torrentGetCalls, 2)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: setTagsBatch set should set labels in one call', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })
  const hash = 'hx'

  let call = 0
  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      call++

      assert.equal(payload.jsonrpc, '2.0')
      assert.equal(payload.method, 'torrent_set')
      assert.deepEqual(payload.params, { ids: [hash], labels: ['new1', 'new2'] })
      return { status: 204, data: null }
    })

    await adapter.setTagsBatch([hash], ['new1', 'new2'], 'set')
    assert.equal(call, 1)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: setTagsBatch add/remove should merge and remove labels', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })
  const hash = 'hy'

  let phase: 'add' | 'remove' = 'add'
  let call = 0
  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      call++

      if (payload.method === 'torrent_get') {
        assert.equal(payload.jsonrpc, '2.0')
        assert.deepEqual(payload.params?.ids, [hash])
        assert.deepEqual(payload.params?.fields, ['hash_string', 'labels'])
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              torrents: [{ hash_string: hash, labels: phase === 'add' ? ['catB', 't1'] : ['catB', 't1', 't2'] }],
            },
          },
        }
      }

      assert.equal(payload.jsonrpc, '2.0')
      assert.equal(payload.method, 'torrent_set')

      if (phase === 'add') {
        assert.deepEqual(payload.params, { ids: [hash], labels: ['catB', 't1', 't2'] })
        phase = 'remove'
      } else {
        assert.deepEqual(payload.params, { ids: [hash], labels: ['t2'] })
      }

      return { status: 204, data: null }
    })

    await adapter.setTagsBatch([hash], ['t2', 'catB', 't1'], 'add')
    await adapter.setTagsBatch([hash], ['t1', 'catB'], 'remove')
    assert.equal(call, 4)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: deleteTags should remove labels from all torrents', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })
  const tagsToDelete = ['t1']

  const sets: Array<{ ids: string[]; labels: string[] }> = []

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')

      if (payload.method === 'torrent_get') {
        const fields = payload.params?.fields
        assert.deepEqual(Array.isArray(fields) ? fields.sort() : fields, fields)
        assert.deepEqual(fields, ['hash_string', 'labels'])
        assert.equal(payload.params?.ids, undefined)
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              torrents: [
                { hash_string: 'h1', labels: ['a', 't1'] },
                { hash_string: 'h2', labels: ['t1'] },
              ],
            },
          },
        }
      }

      assert.equal(payload.method, 'torrent_set')
      sets.push(payload.params)
      return { status: 204, data: null }
    })

    await adapter.deleteTags(...tagsToDelete)

    const normalize = (x: { ids: string[]; labels: string[] }) => ({ ids: [...x.ids].sort(), labels: [...x.labels].sort() })
    const sorted = sets.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    assert.deepEqual(sorted, [
      { ids: ['h1'], labels: ['a'] },
      { ids: ['h2'], labels: [] },
    ])
  } finally {
    mock.restoreAll()
  }
})

test('Transmission legacy: queueMove* should map to queue-move-* RPC methods', async () => {
  const adapter = new TransAdapter()
  const calls: any[] = []

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      calls.push(payload)
      return { data: { result: 'success', arguments: {} } }
    })

    await adapter.queueMoveTop(['a', 'b'])
    await adapter.queueMoveUp(['a'])
    await adapter.queueMoveDown(['x'])
    await adapter.queueMoveBottom(['z'])

    assert.equal(calls[0]?.method, 'queue-move-top')
    assert.deepEqual(calls[0]?.arguments?.ids, ['a', 'b'])
    assert.equal(calls[1]?.method, 'queue-move-up')
    assert.deepEqual(calls[1]?.arguments?.ids, ['a'])
    assert.equal(calls[2]?.method, 'queue-move-down')
    assert.deepEqual(calls[2]?.arguments?.ids, ['x'])
    assert.equal(calls[3]?.method, 'queue-move-bottom')
    assert.deepEqual(calls[3]?.arguments?.ids, ['z'])
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: queueMove* should map to queue_move_* RPC methods', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })
  const calls: any[] = []

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      calls.push(payload)
      return { status: 204, data: null }
    })

    await adapter.queueMoveTop(['a', 'b'])
    await adapter.queueMoveUp(['a'])
    await adapter.queueMoveDown(['x'])
    await adapter.queueMoveBottom(['z'])

    assert.equal(calls[0]?.method, 'queue_move_top')
    assert.deepEqual(calls[0]?.params?.ids, ['a', 'b'])
    assert.equal(calls[1]?.method, 'queue_move_up')
    assert.deepEqual(calls[1]?.params?.ids, ['a'])
    assert.equal(calls[2]?.method, 'queue_move_down')
    assert.deepEqual(calls[2]?.params?.ids, ['x'])
    assert.equal(calls[3]?.method, 'queue_move_bottom')
    assert.deepEqual(calls[3]?.params?.ids, ['z'])
  } finally {
    mock.restoreAll()
  }
})

test('Transmission legacy: addTrackers/removeTrackers/editTracker should use torrent-set trackerAdd/trackerRemove/trackerReplace', async () => {
  const adapter = new TransAdapter()

  const calls: any[] = []

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      calls.push(payload)

      if (payload.method === 'torrent-get') {
        assert.deepEqual(payload.arguments?.fields, ['hashString', 'trackers'])
        return {
          data: {
            result: 'success',
            arguments: {
              torrents: [
                {
                  hashString: 'h1',
                  trackers: [
                    { id: 7, announce: 'udp://a', tier: 0 },
                    { id: 8, announce: 'udp://b', tier: 0 },
                  ],
                },
              ],
            },
          },
        }
      }

      if (payload.method === 'torrent-set') {
        return { data: { result: 'success', arguments: {} } }
      }

      throw new Error(`Unexpected method: ${payload.method}`)
    })

    await adapter.addTrackers('h1', [' udp://x ', '', 'udp://y'])
    await adapter.removeTrackers('h1', ['udp://b', 'udp://missing'])
    await adapter.editTracker('h1', 'udp://a', 'udp://new')

    const add = calls.find(c => c.method === 'torrent-set' && Array.isArray(c.arguments?.trackerAdd))
    assert.deepEqual(add?.arguments, { ids: ['h1'], trackerAdd: ['udp://x', 'udp://y'] })

    const remove = calls.find(c => c.method === 'torrent-set' && Array.isArray(c.arguments?.trackerRemove))
    assert.deepEqual(remove?.arguments, { ids: ['h1'], trackerRemove: [8] })

    const replace = calls.find(c => c.method === 'torrent-set' && Array.isArray(c.arguments?.trackerReplace))
    assert.deepEqual(replace?.arguments, { ids: ['h1'], trackerReplace: [7, 'udp://new'] })
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: addTrackers/removeTrackers/editTracker should use torrent_set tracker_add/tracker_remove/tracker_replace', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  const calls: any[] = []

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      calls.push(payload)

      if (payload.method === 'torrent_get') {
        assert.deepEqual(payload.params?.fields, ['hash_string', 'trackers'])
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              torrents: [
                {
                  hash_string: 'h1',
                  trackers: [
                    { id: 7, announce: 'udp://a', tier: 0 },
                    { id: 8, announce: 'udp://b', tier: 0 },
                  ],
                },
              ],
            },
          },
        }
      }

      if (payload.method === 'torrent_set') {
        return { status: 204, data: null }
      }

      throw new Error(`Unexpected method: ${payload.method}`)
    })

    await adapter.addTrackers('h1', [' udp://x ', '', 'udp://y'])
    await adapter.removeTrackers('h1', ['udp://b', 'udp://missing'])
    await adapter.editTracker('h1', 'udp://a', 'udp://new')

    const add = calls.find(c => c.method === 'torrent_set' && Array.isArray(c.params?.tracker_add))
    assert.deepEqual(add?.params, { ids: ['h1'], tracker_add: ['udp://x', 'udp://y'] })

    const remove = calls.find(c => c.method === 'torrent_set' && Array.isArray(c.params?.tracker_remove))
    assert.deepEqual(remove?.params, { ids: ['h1'], tracker_remove: [8] })

    const replace = calls.find(c => c.method === 'torrent_set' && Array.isArray(c.params?.tracker_replace))
    assert.deepEqual(replace?.params, { ids: ['h1'], tracker_replace: [7, 'udp://new'] })
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: addTorrent should encode large .torrent metainfo without stack overflow', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  const largeSize = 100 * 1024 // > 65535: would typically break spread-based encoding
  const bytes = new Uint8Array(largeSize)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256

  const expected = Buffer.from(bytes).toString('base64')
  let seenMetainfo: unknown = undefined

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')
      assert.equal(payload.method, 'torrent_add')
      seenMetainfo = payload.params?.metainfo

      return {
        status: 200,
        data: { jsonrpc: '2.0', id: payload.id, result: {} },
      }
    })

    const file = {
      name: 'large-linux-iso.torrent',
      arrayBuffer: async () => bytes.buffer,
    }

    await adapter.addTorrent({ files: [file as any] } as any)

    assert.equal(typeof seenMetainfo, 'string')
    assert.equal(seenMetainfo, expected)
  } finally {
    mock.restoreAll()
  }
})
