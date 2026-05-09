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
    saveTransSessionAuth('admin', 'pass')

    assert.equal(restoreTransSessionAuth(), true)
    auth.disconnect()

    transClient.defaults.auth = undefined
    assert.equal(restoreTransSessionAuth(), false)
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

  let genericCreateCalls = 0
  let genericRebootCalls = 0
  let transCreateCalls = 0
  let clearCalls = 0

  const transAdapter = {
    hasCredentials: true,
    checkSession: async () => true,
  }
  const transVersion = { type: 'trans', version: '4.0.0', major: 4, minor: 0, patch: 0, isUnknown: false }

  const deps = {
    restoreTransSessionAuth: () => true,
    hasConfiguredTransUrl: () => false,
    clearTransSessionAuth: () => { clearCalls++ },
    createTransAdapterWithAuth: async () => {
      transCreateCalls++
      return { adapter: transAdapter as any, version: transVersion as any }
    },
    createAdapter: async () => {
      genericCreateCalls++
      throw new Error('generic create should not be called')
    },
    rebootAdapterWithAuth: async () => {
      genericRebootCalls++
      throw new Error('generic reboot should not be called')
    },
  }

  const ok = await auth.checkSession(deps)

  assert.equal(ok, true)
  assert.equal(auth.isAuthenticated, true)
  assert.equal(backend.backendType, 'trans')
  assert.equal(transCreateCalls, 1)
  assert.equal(genericCreateCalls, 0)
  assert.equal(genericRebootCalls, 0)
  assert.equal(clearCalls, 0)
})

test('auth: checkSession returns false for explicit VITE_TR_URL without stored credentials', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()

  let genericCreateCalls = 0
  let transCreateCalls = 0

  const deps = {
    restoreTransSessionAuth: () => false,
    hasConfiguredTransUrl: () => true,
    clearTransSessionAuth: () => {},
    createTransAdapterWithAuth: async () => {
      transCreateCalls++
      throw new Error('trans create should not be called')
    },
    createAdapter: async () => {
      genericCreateCalls++
      throw new Error('generic create should not be called')
    },
    rebootAdapterWithAuth: async () => {
      throw new Error('generic reboot should not be called')
    },
  }

  const ok = await auth.checkSession(deps)

  assert.equal(ok, false)
  assert.equal(auth.isChecking, false)
  assert.equal(genericCreateCalls, 0)
  assert.equal(transCreateCalls, 0)
})

test('auth: checkSession restores session and falls back to temp adapter when rebootAdapterWithAuth fails', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()
  const backend = useBackendStore()

  const tempCheckSession = async () => true
  const tempAdapter = { checkSession: tempCheckSession }
  const tempVersion = { type: 'qbit', version: 'unknown', major: 4, minor: 0, patch: 0, isUnknown: true }

  const deps = {
    createAdapter: async () => ({ adapter: tempAdapter as any, version: tempVersion as any }),
    rebootAdapterWithAuth: async () => { throw new Error('network wobble') }
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

test('auth: checkSession keeps existing adapter when session is valid but rebootAdapterWithAuth fails', async () => {
  setActivePinia(createPinia())

  const auth = useAuthStore()
  const backend = useBackendStore()

  const existingCheckSession = async () => true
  const existingAdapter = { checkSession: existingCheckSession }
  const unknownVersion = { type: 'qbit', version: 'unknown', major: 4, minor: 0, patch: 0, isUnknown: true }
  backend.setAdapter(existingAdapter as any, unknownVersion as any)

  const deps = {
    createAdapter: async () => { throw new Error('not used') },
    rebootAdapterWithAuth: async () => { throw new Error('network wobble') }
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
