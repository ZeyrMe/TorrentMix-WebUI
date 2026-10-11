import axios from 'axios'

/**
 * Transmission RPC 客户端
 *
 * 特殊处理：
 * - 自动处理 409 Conflict，提取 X-Transmission-Session-Id 并重试（单请求最多重试 2 次，防止死循环）
 * - Session ID 存在 axios instance 上（当前导出为单例）
 * - 默认使用 AES-GCM 密文保存 Basic Auth 凭证，密钥优先存为 IndexedDB 中不可导出的 CryptoKey。
 * - 可信内网可显式关闭安全存储，将凭证明文保存在当前标签页的 sessionStorage 中。
 */

// TODO: 若未来需要同时管理多个 Transmission 实例，请将 transClient 改为工厂函数，确保 Session-Id / auth 按后端隔离。

const TRANS_SESSION_AUTH_KEY = 'torrentmix:transmission:session-auth'
const TRANS_FALLBACK_KEY_KEY = 'torrentmix:transmission:session-auth-key'
const AUTH_DB_NAME = 'torrentmix-auth'
const AUTH_DB_STORE = 'keys'
const AUTH_DB_KEY_ID = 'trans-session-auth'
const MAX_409_RETRIES = 2
const TRANS_AUTH_SCHEMA = 2

type StoredSecureTransAuth = {
  schema: typeof TRANS_AUTH_SCHEMA
  mode: 'secure'
  baseURL: string
  iv: string
  data: string
}

type StoredInsecureTransAuth = {
  schema: typeof TRANS_AUTH_SCHEMA
  mode: 'insecure-session'
  baseURL: string
  username: string
  password: string
}

type StoredAnonymousTransAuth = {
  schema: typeof TRANS_AUTH_SCHEMA
  mode: 'anonymous'
  baseURL: string
}

export type TransAuthPersistence = 'secure' | 'insecure-session' | 'anonymous' | 'memory-only'

type TransAuthPayload = {
  username: string
  password: string
}

function getTransEnv(): Record<string, any> {
  const viteEnv = (import.meta as any).env
  if (viteEnv) return viteEnv as Record<string, any>

  if (typeof process !== 'undefined' && (process as any).env) {
    return (process as any).env as Record<string, any>
  }

  return {}
}

export function getConfiguredTransBaseUrl(): string {
  const env = getTransEnv()

  // 开发环境走 Vite 代理
  if (env.DEV) return '/transmission/rpc'

  // 生产环境默认同源（推荐），不再默认指向浏览器的 localhost（远程访问会直接翻车）
  const configured = String(env.VITE_TR_URL ?? '').trim()
  return configured || '/transmission/rpc'
}

export function hasConfiguredTransUrl(): boolean {
  const env = getTransEnv()
  return String(env.VITE_TR_URL ?? '').trim().length > 0
}

export function usesSecureCredentialStorage(): boolean {
  const raw = String(getTransEnv().VITE_SECURE_CREDENTIAL_STORAGE ?? 'true').trim().toLowerCase()
  return !['false', '0', 'off', 'no'].includes(raw)
}

const baseURL = getConfiguredTransBaseUrl()

function getTransAuthScope(): string {
  const configured = String(getTransEnv().VITE_TR_URL ?? '').trim()
  return configured || baseURL
}

export const transClient = axios.create({
  baseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    const storage = window.sessionStorage
    const probeKey = `${TRANS_SESSION_AUTH_KEY}:probe`
    storage.setItem(probeKey, '1')
    storage.removeItem(probeKey)
    return storage
  } catch {
    return null
  }
}

function getSubtleCrypto(): SubtleCrypto | null {
  const cryptoObj = (globalThis as any).crypto
  return cryptoObj?.subtle ?? null
}

function getIndexedDB(): IDBFactory | null {
  return (globalThis as any).indexedDB ?? null
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function openAuthDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = getIndexedDB()
    if (!idb) {
      reject(new Error('IndexedDB unavailable'))
      return
    }

    const request = idb.open(AUTH_DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUTH_DB_STORE)) {
        request.result.createObjectStore(AUTH_DB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

function idbGetKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTH_DB_STORE, 'readonly')
    const request = tx.objectStore(AUTH_DB_STORE).get(AUTH_DB_KEY_ID)
    request.onsuccess = () => resolve((request.result as CryptoKey | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
  })
}

function idbPutKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTH_DB_STORE, 'readwrite')
    const request = tx.objectStore(AUTH_DB_STORE).put(key, AUTH_DB_KEY_ID)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'))
  })
}

/**
 * 获取（或首次创建）用于加密凭证的 AES-GCM 密钥。
 * 优先使用 IndexedDB 保存不可导出的 CryptoKey；降级路径把密钥字节存进 sessionStorage。
 */
async function getAuthCryptoKey(create: boolean): Promise<CryptoKey | null> {
  const subtle = getSubtleCrypto()
  if (!subtle) return null

  try {
    const db = await openAuthDb()
    try {
      const existing = await idbGetKey(db)
      if (existing) return existing
      if (!create) return null

      const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await idbPutKey(db, key)
      return key
    } finally {
      db.close()
    }
  } catch {
    // IndexedDB 不可用：密钥退化为可导出并与密文同存 sessionStorage
    const storage = getSessionStorage()
    if (!storage) return null

    const storedKey = storage.getItem(TRANS_FALLBACK_KEY_KEY)
    if (storedKey) {
      try {
        return await subtle.importKey('raw', base64ToBytes(storedKey).buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt', 'decrypt'])
      } catch {
        storage.removeItem(TRANS_FALLBACK_KEY_KEY)
      }
    }

    if (!create) return null

    const keyBytes = new Uint8Array(32)
    ;(globalThis as any).crypto.getRandomValues(keyBytes)
    storage.setItem(TRANS_FALLBACK_KEY_KEY, bytesToBase64(keyBytes))
    return subtle.importKey('raw', keyBytes.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }
}

function removeStoredTransSessionAuth(): void {
  const storage = getSessionStorage()
  storage?.removeItem(TRANS_SESSION_AUTH_KEY)
  storage?.removeItem(TRANS_FALLBACK_KEY_KEY)
}

export function clearTransSessionId(): void {
  const headers = transClient.defaults.headers as any
  delete headers['X-Transmission-Session-Id']
  delete headers['x-transmission-session-id']
  delete headers.common?.['X-Transmission-Session-Id']
  delete headers.common?.['x-transmission-session-id']
}

export async function saveTransSessionAuth(username: string, password: string): Promise<TransAuthPersistence> {
  const storage = getSessionStorage()

  if (!username && !password) {
    if (!storage) return 'memory-only'
    const payload: StoredAnonymousTransAuth = {
      schema: TRANS_AUTH_SCHEMA,
      mode: 'anonymous',
      baseURL: getTransAuthScope(),
    }
    storage.setItem(TRANS_SESSION_AUTH_KEY, JSON.stringify(payload))
    return 'anonymous'
  }

  if (!storage) return 'memory-only'

  if (!usesSecureCredentialStorage()) {
    const payload: StoredInsecureTransAuth = {
      schema: TRANS_AUTH_SCHEMA,
      mode: 'insecure-session',
      baseURL: getTransAuthScope(),
      username,
      password,
    }
    storage.setItem(TRANS_SESSION_AUTH_KEY, JSON.stringify(payload))
    return 'insecure-session'
  }

  const subtle = getSubtleCrypto()
  if (!subtle) return 'memory-only'

  try {
    const key = await getAuthCryptoKey(true)
    if (!key) return 'memory-only'

    const iv = new Uint8Array(12)
    ;(globalThis as any).crypto.getRandomValues(iv)

    const plaintext = new TextEncoder().encode(JSON.stringify({ username, password } satisfies TransAuthPayload))
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

    const payload: StoredSecureTransAuth = {
      schema: TRANS_AUTH_SCHEMA,
      mode: 'secure',
      baseURL: getTransAuthScope(),
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(ciphertext)),
    }
    storage.setItem(TRANS_SESSION_AUTH_KEY, JSON.stringify(payload))
    return 'secure'
  } catch {
    // 加密失败时放弃持久化（保持内存态登录），绝不回退到明文存储
    removeStoredTransSessionAuth()
    return 'memory-only'
  }
}

export async function restoreTransSessionAuth(): Promise<boolean> {
  if (transClient.defaults.auth) return true

  const storage = getSessionStorage()
  if (!storage) return false

  const raw = storage.getItem(TRANS_SESSION_AUTH_KEY)
  if (!raw) return false

  try {
    const payload = JSON.parse(raw) as Record<string, unknown>
    if (payload.baseURL !== getTransAuthScope()) {
      clearTransSessionAuth()
      return false
    }

    if (payload.mode === 'anonymous') return true

    if (payload.mode === 'insecure-session') {
      if (
        usesSecureCredentialStorage() ||
        typeof payload.username !== 'string' ||
        typeof payload.password !== 'string' ||
        (!payload.username && !payload.password)
      ) {
        clearTransSessionAuth()
        return false
      }

      transClient.defaults.auth = { username: payload.username, password: payload.password }
      return true
    }

    // 接受 schema 2 secure 记录，以及升级前没有 schema/mode 的 AES-GCM 记录。
    if (typeof payload.iv !== 'string' || typeof payload.data !== 'string') {
      clearTransSessionAuth()
      return false
    }

    const subtle = getSubtleCrypto()
    if (!subtle) {
      clearTransSessionAuth()
      return false
    }

    const key = await getAuthCryptoKey(false)
    if (!key) {
      clearTransSessionAuth()
      return false
    }

    const iv = payload.iv
    const data = payload.data
    const plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(iv) },
      key,
      base64ToBytes(data).buffer as ArrayBuffer,
    )
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<TransAuthPayload>
    const username = parsed.username
    const password = parsed.password

    if (typeof username !== 'string' || typeof password !== 'string' || (!username && !password)) {
      clearTransSessionAuth()
      return false
    }

    transClient.defaults.auth = { username, password }
    return true
  } catch {
    clearTransSessionAuth()
    return false
  }
}

export function clearTransSessionAuth(): void {
  transClient.defaults.auth = undefined
  clearTransSessionId()
  removeStoredTransSessionAuth()
}

// 响应拦截器：处理 409 Conflict
transClient.interceptors.response.use(
  response => response,
  async error => {
    const is409 = error.response?.status === 409
    const hasSessionIdHeader = error.response?.headers?.['x-transmission-session-id']
    const retryCount = Number(error.config?.__transRetry409 ?? 0)

    if (is409 && hasSessionIdHeader && retryCount < MAX_409_RETRIES) {
      // 提取新的 Session ID
      const sessionId = String(error.response.headers['x-transmission-session-id'])
      transClient.defaults.headers['X-Transmission-Session-Id'] = sessionId

      // 重试原请求（带上限，避免后端持续 409 时无限循环）。
      // error.config 是合并后的配置，可能携带过期 Session-Id 且优先级高于 defaults，需显式覆盖。
      error.config.__transRetry409 = retryCount + 1
      if (error.config.headers) {
        error.config.headers['X-Transmission-Session-Id'] = sessionId
      }
      return transClient.request(error.config)
    }

    return Promise.reject(error)
  }
)
