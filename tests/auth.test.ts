import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

import { useAuthStore } from '../src/store/auth.ts'
import { useBackendStore } from '../src/store/backend.ts'
import { clearTransSessionAuth, restoreTransSessionAuth, saveTransSessionAuth, transClient } from '../src/api/trans-client.ts'

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

test('auth: login sets authenticated and initializes backend adapter (injected deps)', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()
  const backend = useBackendStore()

  const deps = {
    detectBackendTypeOnly: async () => 'qbit' as const,
    detectBackendWithVersionAuth: async () => ({
      type: 'qbit' as const,
      version: '5.0.0',
      major: 5,
      minor: 0,
      patch: 0,
    }),
    createAdapterByType: async () => ({
      login: async () => {},
      logout: async () => {},
      checkSession: async () => true,
      fetchList: async () => ({ torrents: new Map() }),
      addTorrent: async () => {},
      pause: async () => {},
      resume: async () => {},
      delete: async () => {},
      fetchDetail: async () => { throw new Error('not used') },
      recheck: async () => {},
      recheckBatch: async () => {},
      reannounce: async () => {},
      reannounceBatch: async () => {},
      forceStart: async () => {},
      forceStartBatch: async () => {},
      setDownloadLimit: async () => {},
      setDownloadLimitBatch: async () => {},
      setUploadLimit: async () => {},
      setUploadLimitBatch: async () => {},
      setLocation: async () => {},
      setCategory: async () => {},
      setCategoryBatch: async () => {},
      setTags: async () => {},
      setTagsBatch: async () => {},
      getTransferSettings: async () => ({}) as any,
      setTransferSettings: async () => {},
      getCapabilities: async () => ({}) as any,
      getPreferences: async () => ({}) as any,
      setPreferences: async () => {},
      getCategories: async () => new Map(),
      createCategory: async () => {},
      editCategory: async () => {},
      deleteCategories: async () => {},
      setCategorySavePath: async () => {},
      getTags: async () => [],
      createTags: async () => {},
      deleteTags: async () => {},
    }),
    saveVersionCache: () => {},
    clearVersionCache: () => {},
    QbitAdapter: class QbitAdapterMock {
      constructor(_features: unknown) {}
    } as any,
    DEFAULT_QBIT_FEATURES: {},
    TransAdapter: class TransAdapterMock {} as any,
  } as const

  await auth.login('u', 'p', deps as any)

  assert.equal(auth.isAuthenticated, true)
  assert.ok(backend.adapter)
  assert.equal(backend.backendType, 'qbit')
  assert.equal(backend.version?.major, 5)
})

test('auth: logout calls adapter.logout and clears authenticated flag', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()
  const backend = useBackendStore()

  let called = 0
  backend.adapter = { logout: async () => { called++ } } as any
  auth.isAuthenticated = true as any

  await auth.logout()

  assert.equal(called, 1)
  assert.equal(auth.isAuthenticated, false)
})

test('auth: disconnect blocks session restore until next login', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()

  auth.disconnect()

  let called = 0
  const deps = {
    createAdapter: async () => {
      called++
      throw new Error('not used')
    },
    rebootAdapterWithAuth: async () => {
      called++
      throw new Error('not used')
    },
  }

  const ok = await auth.checkSession(deps as any)
  assert.equal(ok, false)
  assert.equal(called, 0)
})

test('auth: disconnect clears persisted Transmission Basic Auth', async () => {
  const restoreWindow = installSessionStorage()
  const originalAuth = transClient.defaults.auth

  try {
    setActivePinia(createPinia())
    clearTransSessionAuth()

    const auth = useAuthStore()
    await saveTransSessionAuth('admin', 'pass')

    assert.equal(await restoreTransSessionAuth(), true)
    auth.disconnect()

    transClient.defaults.auth = undefined
    assert.equal(await restoreTransSessionAuth(), false)
  } finally {
    clearTransSessionAuth()
    transClient.defaults.auth = originalAuth
    restoreWindow()
  }
})

test('auth: checkSession sets isSecuredConnection from adapter.hasCredentials', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()
  const backend = useBackendStore()

  const adapter = { checkSession: async () => true, hasCredentials: false }
  backend.setAdapter(adapter as any, { type: 'trans', version: '4.0.0', major: 4, minor: 0, patch: 0, isUnknown: false } as any)

  const ok = await auth.checkSession()

  assert.equal(ok, true)
  assert.equal(auth.isAuthenticated, true)
  assert.equal(auth.isSecuredConnection, false)
})

test('auth: checkSession restores Transmission credentials without generic probing', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()
  const backend = useBackendStore()

  let transCreateCalls = 0
  let clearCalls = 0

  const transAdapter = {
    hasCredentials: true,
    checkSession: async () => true,
  }
  const transVersion = { type: 'trans', version: '4.0.0', major: 4, minor: 0, patch: 0, isUnknown: false }

  const deps = {
    detectBackendTypeOnly: async () => 'trans' as const,
    restoreTransSessionAuth: () => true,
    clearTransSessionAuth: () => { clearCalls++ },
    createTransAdapterWithAuth: async () => {
      transCreateCalls++
      return { adapter: transAdapter as any, version: transVersion as any }
    },
  }

  const ok = await auth.checkSession(deps)

  assert.equal(ok, true)
  assert.equal(auth.isAuthenticated, true)
  assert.equal(backend.backendType, 'trans')
  assert.equal(transCreateCalls, 1)
  assert.equal(clearCalls, 0)
})

test('auth: selected Transmission without stored credentials performs no backend request', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()

  let transCreateCalls = 0
  let qbitCreateCalls = 0

  const deps = {
    detectBackendTypeOnly: async () => 'trans' as const,
    restoreTransSessionAuth: () => false,
    clearTransSessionAuth: () => {},
    createTransAdapterWithAuth: async () => {
      transCreateCalls++
      throw new Error('trans create should not be called')
    },
    createAdapterByType: async () => {
      qbitCreateCalls++
      throw new Error('qBittorrent adapter should not be created')
    },
  }

  const ok = await auth.checkSession(deps)

  assert.equal(ok, false)
  assert.equal(auth.isChecking, false)
  assert.equal(qbitCreateCalls, 0)
  assert.equal(transCreateCalls, 0)
})

test('auth: selected qBittorrent never reads Transmission credentials or creates a Transmission adapter', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()
  const backend = useBackendStore()
  let transRestoreCalls = 0
  let transCreateCalls = 0

  const qbitAdapter = { checkSession: async () => true }
  const qbitVersion = { type: 'qbit', version: '5.1.0', major: 5, minor: 1, patch: 0, isUnknown: false }
  const deps = {
    detectBackendTypeOnly: async () => 'qbit' as const,
    restoreTransSessionAuth: () => {
      transRestoreCalls++
      return true
    },
    createTransAdapterWithAuth: async () => {
      transCreateCalls++
      throw new Error('Transmission adapter should not be created')
    },
    createAdapterByType: async (type: string) => {
      assert.equal(type, 'qbit')
      return qbitAdapter as any
    },
    createQbitAdapterWithAuth: async () => ({ adapter: qbitAdapter as any, version: qbitVersion as any }),
  }

  const ok = await auth.checkSession(deps as any)

  assert.equal(ok, true)
  assert.equal(auth.isAuthenticated, true)
  assert.equal(backend.backendType, 'qbit')
  assert.equal(transRestoreCalls, 0)
  assert.equal(transCreateCalls, 0)
})

test('auth: insecure credential storage explicitly persists Transmission Basic Auth in sessionStorage', async () => {
  const storage = createFakeStorage()
  const restoreWindow = installSessionStorage(storage)
  const originalAuth = transClient.defaults.auth
  const previousMode = process.env.VITE_SECURE_CREDENTIAL_STORAGE
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

  try {
    process.env.VITE_SECURE_CREDENTIAL_STORAGE = 'false'
    clearTransSessionAuth()

    assert.equal(await saveTransSessionAuth('admin', 'pass'), 'insecure-session')
    const raw = storage.getItem('torrentmix:transmission:session-auth')
    assert.ok(raw)
    assert.equal(JSON.parse(raw).mode, 'insecure-session')

    transClient.defaults.auth = undefined
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
    assert.equal(await restoreTransSessionAuth(), true)
    assert.deepEqual(transClient.defaults.auth, { username: 'admin', password: 'pass' })
  } finally {
    clearTransSessionAuth()
    transClient.defaults.auth = originalAuth
    if (previousMode === undefined) delete process.env.VITE_SECURE_CREDENTIAL_STORAGE
    else process.env.VITE_SECURE_CREDENTIAL_STORAGE = previousMode
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
    else delete (globalThis as any).crypto
    restoreWindow()
  }
})

test('auth: anonymous Transmission login stores a refresh marker without credentials', async () => {
  const storage = createFakeStorage()
  const restoreWindow = installSessionStorage(storage)
  const originalAuth = transClient.defaults.auth
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

  try {
    clearTransSessionAuth()

    assert.equal(await saveTransSessionAuth('', ''), 'anonymous')
    const raw = storage.getItem('torrentmix:transmission:session-auth')
    assert.ok(raw)
    assert.deepEqual(JSON.parse(raw), {
      schema: 2,
      mode: 'anonymous',
      baseURL: '/transmission/rpc',
    })

    transClient.defaults.auth = undefined
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
    assert.equal(await restoreTransSessionAuth(), true)
    assert.equal(transClient.defaults.auth, undefined)
  } finally {
    clearTransSessionAuth()
    transClient.defaults.auth = originalAuth
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
    else delete (globalThis as any).crypto
    restoreWindow()
  }
})

test('auth: qBittorrent restore falls back to conservative adapter when version detection fails', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()
  const backend = useBackendStore()

  const tempCheckSession = async () => true
  const tempAdapter = { checkSession: tempCheckSession }
  const deps = {
    detectBackendTypeOnly: async () => 'qbit' as const,
    createAdapterByType: async () => tempAdapter as any,
    createQbitAdapterWithAuth: async () => { throw new Error('network wobble') },
  }

  const originalWarn = console.warn
  console.warn = () => {}
  try {
    const ok = await auth.checkSession(deps as any)

    assert.equal(ok, true)
    assert.equal(auth.isAuthenticated, true)
    assert.equal(auth.isChecking, false)

    assert.strictEqual((backend.adapter as any)?.checkSession, tempCheckSession)
    assert.equal(backend.version?.isUnknown, true)
  } finally {
    console.warn = originalWarn
  }
})

test('auth: checkSession keeps existing qBittorrent adapter when version restore fails', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()
  const backend = useBackendStore()

  const existingCheckSession = async () => true
  const existingAdapter = { checkSession: existingCheckSession }
  const unknownVersion = { type: 'qbit', version: 'unknown', major: 4, minor: 0, patch: 0, isUnknown: true }
  backend.setAdapter(existingAdapter as any, unknownVersion as any)

  const deps = {
    createQbitAdapterWithAuth: async () => { throw new Error('network wobble') },
  }

  const originalWarn = console.warn
  console.warn = () => {}
  try {
    const ok = await auth.checkSession(deps as any)

    assert.equal(ok, true)
    assert.equal(auth.isAuthenticated, true)
    assert.equal(auth.isChecking, false)

    assert.strictEqual((backend.adapter as any)?.checkSession, existingCheckSession)
    assert.equal(backend.version?.isUnknown, true)
  } finally {
    console.warn = originalWarn
  }
})
