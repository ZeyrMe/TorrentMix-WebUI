import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

function resolveDevProxyTarget(
  configured: string,
  fallback: string,
  envKey: string,
  options?: { originOnly?: boolean }
) {
  const trimmed = configured.trim()
  if (!trimmed) return fallback

  try {
    const parsed = new URL(trimmed)
    return options?.originOnly ? parsed.origin : parsed.toString()
  } catch {
    console.warn(`[vite] ${envKey}="${trimmed}" 不是合法的绝对 URL，开发代理将回退到 ${fallback}`)
    return fallback
  }
}

function resolveTransmissionProxy(
  configured: string,
  fallback: string,
  envKey: string,
) {
  const trimmed = configured.trim()
  const candidate = trimmed || fallback

  try {
    const parsed = new URL(candidate)
    const rpcPath = parsed.pathname.replace(/\/+$/, '') || '/transmission/rpc'
    const pathPrefix = rpcPath.endsWith('/rpc')
      ? (rpcPath.slice(0, -'/rpc'.length) || '/')
      : rpcPath

    return {
      target: parsed.origin,
      pathPrefix,
    }
  } catch {
    console.warn(`[vite] ${envKey}="${trimmed}" 不是合法的绝对 URL，开发代理将回退到 ${fallback}`)
    return {
      target: 'http://localhost:9091',
      pathPrefix: '/transmission',
    }
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const qbitProxyTarget = resolveDevProxyTarget(
    String(env.VITE_QB_URL ?? ''),
    'http://localhost:8080',
    'VITE_QB_URL',
  )
  const transmissionProxy = resolveTransmissionProxy(
    String(env.VITE_TR_URL ?? ''),
    'http://localhost:9091/transmission/rpc',
    'VITE_TR_URL',
  )

  return {
    // 生产构建使用相对 base，保证部署在子路径（例如 /transmission/web/）也能正确加载静态资源。
    base: command === 'build' ? './' : '/',
    plugins: [vue()],
    build: {
      // 生成 Vite manifest，供发布脚本稳定解析入口产物（避免对 index.html 结构产生隐式依赖）。
      manifest: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    server: {
      proxy: {
        // 开发环境优先复用 .env 中的后端地址，未设置时再回退到本地默认端口。
        '/api': {
          target: qbitProxyTarget,
          changeOrigin: true
        },
        // Transmission RPC 在开发环境下保留 VITE_TR_URL 中的路径前缀，避免子路径部署时 dev/prod 行为不一致。
        '/transmission': {
          target: transmissionProxy.target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/transmission/, transmissionProxy.pathPrefix)
        }
      }
    }
  }
})
