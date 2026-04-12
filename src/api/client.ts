import axios from 'axios'

/**
 * 认证失败错误 - 需要清理状态并跳转登录
 */
export class AuthError extends Error {
  name = 'AuthError'
  constructor(message = 'Session expired or unauthorized') {
    super(message)
  }
}

/**
 * 判断是否为致命错误（轮询应立即停止）
 */
export function isFatalError(error: unknown): boolean {
  return error instanceof AuthError
}

function getConfiguredQbitBaseUrl(): string {
  // `import.meta.env` is Vite-specific; guard it for non-Vite runtimes (e.g. Node tests).
  const env = (import.meta as any).env ?? {}
  // 开发环境走 Vite 代理；实际代理目标由 vite.config.ts 从 .env 或默认值决定。
  if (env.DEV) return ''
  return String(env.VITE_QB_URL ?? '').trim()
}

function isSameOrigin(baseUrl: string): boolean {
  if (!baseUrl) return true
  if (typeof window === 'undefined') return true
  try {
    const resolved = new URL(baseUrl, window.location.href)
    return resolved.origin === window.location.origin
  } catch {
    return false
  }
}

export function getQbitBaseUrl(): string {
  return getConfiguredQbitBaseUrl()
}

const baseURL = getConfiguredQbitBaseUrl()
const env = (import.meta as any).env ?? {}
const allowCrossOrigin = env.VITE_ALLOW_CROSS_ORIGIN === 'true'
const sameOrigin = isSameOrigin(baseURL)
const withCredentials = sameOrigin || (allowCrossOrigin && baseURL.length > 0)

if (!sameOrigin && !allowCrossOrigin && baseURL.length > 0) {
  console.warn(
    '[Network] VITE_QB_URL is cross-origin; disabling withCredentials. Set VITE_ALLOW_CROSS_ORIGIN=true to override.'
  )
}

export const apiClient = axios.create({
  baseURL,
  timeout: 10000,
  withCredentials  // 默认仅同源携带 cookie，避免跨域凭证风险
})

// 内部标记：用于静默验证，不触发登录跳转
const SILENT_CHECK_FLAG = '__silent_check__'

// 响应拦截器：403/401 抛出 AuthError，让调用方决定如何处理
apiClient.interceptors.response.use(
  response => response,
  error => {
    // 静默验证请求不触发 AuthError，直接 reject
    if (error.config?.headers?.[SILENT_CHECK_FLAG]) {
      return Promise.reject(error)
    }

    // 403 Forbidden: 会话过期，抛出 AuthError
    if (error.response?.status === 403) {
      return Promise.reject(new AuthError('Session expired'))
    }

    // 401 Unauthorized: 也抛出 AuthError（兼容其他后端）
    if (error.response?.status === 401) {
      return Promise.reject(new AuthError('Unauthorized'))
    }

    return Promise.reject(error)
  }
)

// 创建一个用于静默验证的客户端（不触发 403 跳转）
export const silentApiClient = axios.create({
  baseURL,
  timeout: 5000,  // 验证请求超时时间更短
  withCredentials
})

// 给静默请求加标记
silentApiClient.interceptors.request.use(config => {
  config.headers = config.headers || {}
  config.headers[SILENT_CHECK_FLAG] = 'true'
  return config
})
