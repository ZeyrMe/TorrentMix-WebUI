import { execSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const DIST_DIR = path.join(ROOT, 'dist')
const OUT_DIR = path.join(ROOT, 'artifacts', 'publish')

const CHANNEL = process.env.CHANNEL?.trim() || 'stable'

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts })
}

function runCapture(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', ...opts }).trim()
}

async function ensureEmptyDir(dir) {
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
}

async function copyDir(src, dest) {
  // Node 18+ supports fs.cp
  await fs.cp(src, dest, { recursive: true })
}

async function listFilesRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(full))
      continue
    }
    if (entry.isFile()) files.push(full)
  }
  return files
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function sha256Base64(buf) {
  return crypto.createHash('sha256').update(buf).digest('base64')
}

function toIntegrity(sha256b64) {
  return `sha256-${sha256b64}`
}

function normalizeRelPath(relPath) {
  return relPath.replace(/\\/g, '/').replace(/^\.\//, '')
}

function parseHtmlEntries(html) {
  const js = []
  const css = []

  const scriptRe = /<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g
  const cssRe = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g

  for (const m of html.matchAll(scriptRe)) {
    if (m[1]) js.push(m[1])
  }
  for (const m of html.matchAll(cssRe)) {
    if (m[1]) css.push(m[1])
  }

  const clean = (p) => normalizeRelPath(String(p).trim().replace(/^\//, '').replace(/^\.\//, ''))
  return {
    js: js.map(clean).filter(Boolean),
    css: css.map(clean).filter(Boolean),
  }
}

async function tryParseViteManifestEntries(releaseDir) {
  // Vite build.manifest 输出位置（Vite 5+）：dist/.vite/manifest.json
  const manifestPath = path.join(releaseDir, '.vite', 'manifest.json')
  let raw = ''
  try {
    raw = await fs.readFile(manifestPath, 'utf8')
  } catch {
    return null
  }

  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch {
    return null
  }
  if (!manifest || typeof manifest !== 'object') return null

  const records = Object.values(manifest)
  const entry =
    manifest['index.html'] ||
    records.find((r) => r && typeof r === 'object' && r.isEntry === true)

  if (!entry || typeof entry !== 'object') return null

  const js = entry.file ? [String(entry.file)] : []
  const css = Array.isArray(entry.css) ? entry.css.map(String) : []

  const clean = (p) => normalizeRelPath(String(p).trim().replace(/^\//, '').replace(/^\.\//, ''))
  return {
    js: js.map(clean).filter(Boolean),
    css: css.map(clean).filter(Boolean),
  }
}

async function resolveEntryAssets(releaseDir) {
  const fromVite = await tryParseViteManifestEntries(releaseDir)
  if (fromVite) return fromVite

  const indexHtml = await fs.readFile(path.join(releaseDir, 'index.html'), 'utf8')
  return parseHtmlEntries(indexHtml)
}

function buildCspMeta({ scriptSha256B64 }) {
  const scriptHash = `sha256-${scriptSha256B64}`
  return [
    "default-src 'self'",
    `script-src 'self' '${scriptHash}'`,
    // Vue 会用到 style attribute；不引入复杂 hash 方案，保守放行 inline style。
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    "connect-src 'self'",
  ].join('; ')
}

function buildPortableHtml({ baseHtml, cssText, jsText }) {
  // 移除外链资源（fonts.css / Vite 产物）
  let html = baseHtml
    .replace(/<link[^>]*href="\.\/fonts\.css"[^>]*>\s*/g, '')
    .replace(/<script[^>]*type="module"[^>]*src="[^"]+"[^>]*><\/script>\s*/g, '')
    .replace(/<link[^>]*rel="stylesheet"[^>]*href="[^"]+"[^>]*>\s*/g, '')

  // 注入内联 CSS/JS
  html = html.replace(
    '</head>',
    `  <style>\n${cssText}\n  </style>\n</head>`
  )

  html = html.replace(
    '</body>',
    `  <script type="module">\n${jsText}\n  </script>\n</body>`
  )

  // 重写 CSP：允许当前内联脚本（用 hash），避免 script 'unsafe-inline'
  const csp = buildCspMeta({ scriptSha256B64: sha256Base64(Buffer.from(jsText, 'utf8')) })
  if (/<meta\s+http-equiv="Content-Security-Policy"/i.test(html)) {
    html = html.replace(
      /<meta\s+http-equiv="Content-Security-Policy"[^>]*content="[^"]*"[^>]*>/i,
      `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    )
  } else {
    html = html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`
    )
  }

  return html
}

function deriveGhPagesLatestUrl(repoFullName) {
  const v = String(repoFullName || '').trim()
  const parts = v.split('/')
  if (parts.length !== 2) return ''
  const [ownerRaw, repoRaw] = parts
  const owner = String(ownerRaw || '').trim()
  const repo = String(repoRaw || '').trim()
  if (!owner || !repo) return ''

  const ownerLower = owner.toLowerCase()
  const repoLower = repo.toLowerCase()
  // user/organization pages repository: owner.github.io
  if (repoLower === `${ownerLower}.github.io`) {
    return `https://${owner}.github.io/latest.json`
  }
  return `https://${owner}.github.io/${repo}/latest.json`
}

function tryDeriveRepoFromGitRemote() {
  try {
    const origin = runCapture('git config --get remote.origin.url')
    if (!origin) return ''

    // https://github.com/OWNER/REPO.git
    const https = origin.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i)
    if (https) return `${https[1]}/${https[2]}`

    // git@github.com:OWNER/REPO.git
    const ssh = origin.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i)
    if (ssh) return `${ssh[1]}/${ssh[2]}`
  } catch {}
  return ''
}

function deriveRepoFullName() {
  return String(process.env.GITHUB_REPOSITORY || '').trim() || tryDeriveRepoFromGitRemote()
}

function deriveDefaultLatestCandidates() {
  const explicit = String(process.env.DEFAULT_LATEST_URL || '').trim()
  if (explicit) return [explicit]

  const repo = deriveRepoFullName()
  if (!repo) return []

  const ghPages = deriveGhPagesLatestUrl(repo)
  const jsDelivr = `https://cdn.jsdelivr.net/gh/${repo}@gh-pages/latest.json`

  return [ghPages, jsDelivr].filter(Boolean)
}

function buildLoaderHtml() {
  const defaultCandidates = deriveDefaultLatestCandidates()
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'unsafe-inline' https:;
               style-src 'self' 'unsafe-inline' https:;
               img-src 'self' data:;
               connect-src 'self' https:;
               font-src 'self' data:;">
    <title>Torrent WebUI Loader</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #fafafa; color: #111827; }
      .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      .card { width: min(720px, 100%); background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.04); padding: 18px; }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { margin: 8px 0; color: #4b5563; font-size: 14px; line-height: 1.5; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
      .row { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
      input { flex: 1 1 360px; min-width: 240px; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 10px; font-size: 14px; }
      button { padding: 10px 12px; border-radius: 10px; border: 1px solid #111827; background: #111827; color: #fff; font-weight: 600; cursor: pointer; }
      button.secondary { background: #fff; color: #111827; }
      .status { margin-top: 10px; font-size: 13px; color: #374151; }
      .warn { margin-top: 10px; padding: 10px 12px; background: #fffbeb; border: 1px solid #f59e0b33; border-radius: 12px; color: #92400e; font-size: 13px; }
      .err { margin-top: 10px; padding: 10px 12px; background: #fef2f2; border: 1px solid #ef444433; border-radius: 12px; color: #991b1b; font-size: 13px; white-space: pre-wrap; }
      a { color: #111827; }
    </style>
  </head>
  <body>
    <div id="app">
      <div class="wrap">
        <div class="card">
          <h1>WebUI Loader</h1>
          <p>用途：把这一页当作 <code>index.html</code> 放到 qBittorrent/Transmission 的 WebUI 目录里；它会从远端 <code>latest.json</code> 读取版本，再按 <code>manifest.json</code> 从 CDN 加载 JS/CSS（页面保持同源，后端 API 仍访问当前域名）。</p>
          <div class="warn">
            安全提示：启用“远端更新”本质是在信任远端脚本。建议使用自建域名/私有源，并配合完整 HTTPS、严格 CSP、以及可审计的发布流程。
          </div>

          <div class="row">
            <input id="manifestUrl" placeholder="latest.json URL（例如 https://YOUR.DOMAIN/latest.json）" />
            <button id="saveBtn" class="secondary" type="button">保存</button>
            <button id="loadBtn" type="button">加载</button>
          </div>

          <div class="row">
            <input id="pinVersion" placeholder="固定版本（例如 0.1.0，可留空）" />
            <button id="pinBtn" class="secondary" type="button">固定</button>
            <button id="unpinBtn" class="secondary" type="button">解除</button>
          </div>

          <div class="status" id="status">状态：等待配置</div>
          <div class="err" id="error" style="display:none"></div>
        </div>
      </div>
    </div>

    <script type="module">
      const STORAGE_KEY = 'torrent-webui:latest-url'
      const PIN_KEY = 'torrent-webui:pinned-version'
      const CACHE_KEY = 'torrent-webui:cached-manifest'
      const RELOAD_ONCE_KEY = 'torrent-webui:reload-once'
      const CONFIG_URL = './config.json'
      const DEFAULT_CANDIDATES = ${JSON.stringify(defaultCandidates)}

      const els = {
        input: document.getElementById('manifestUrl'),
        save: document.getElementById('saveBtn'),
        load: document.getElementById('loadBtn'),
        pin: document.getElementById('pinVersion'),
        pinBtn: document.getElementById('pinBtn'),
        unpinBtn: document.getElementById('unpinBtn'),
        status: document.getElementById('status'),
        error: document.getElementById('error'),
      }

      function setStatus(text) {
        els.status.textContent = '状态：' + text
      }

      function setError(err) {
        if (!err) {
          els.error.style.display = 'none'
          els.error.textContent = ''
          return
        }
        els.error.style.display = 'block'
        els.error.textContent = String(err)
      }

      function normalizePinnedVersion(ver) {
        const raw = String(ver || '').trim()
        if (!raw) return ''
        const v = raw.startsWith('v') ? raw.slice(1) : raw
        if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(v)) return ''
        return v
      }

      function dedupeStrings(list) {
        const out = []
        const seen = new Set()
        for (const v of list) {
          const s = String(v || '').trim()
          if (!s) continue
          if (seen.has(s)) continue
          seen.add(s)
          out.push(s)
        }
        return out
      }

      function pickCandidates(config) {
        const qs = new URLSearchParams(location.search)
        const fromQuery = qs.get('latest') || qs.get('manifest') || ''
        const input = String(els.input?.value || '').trim()
        const saved = String(localStorage.getItem(STORAGE_KEY) || '').trim()
        const fromConfig = String(config?.latestUrl || '').trim()
        const configCandidates = Array.isArray(config?.candidates) ? config.candidates : []

        // 默认尝试同目录：在本地静态目录里直接打开 loader.html 也能跑起来
        const defaults = ['./latest.json']

        return dedupeStrings([fromQuery, input, saved, fromConfig, ...configCandidates, ...DEFAULT_CANDIDATES, ...defaults])
      }

      async function fetchJson(url, timeoutMs = 3500) {
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
          if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText)
          return await res.json()
        } finally {
          clearTimeout(t)
        }
      }

      async function tryLoadConfig() {
        const u = new URL(CONFIG_URL, location.href)
        try {
          const data = await fetchJson(u.toString(), 300)
          if (!data || typeof data !== 'object') return null
          return data
        } catch {
          return null
        }
      }

      function readCachedManifest() {
        try {
          const raw = localStorage.getItem(CACHE_KEY)
          if (!raw) return null
          const data = JSON.parse(raw)
          if (!data || typeof data !== 'object') return null
          if (!data.manifestUrl || !data.manifest) return null
          return data
        } catch {
          return null
        }
      }

      function writeCachedManifest(manifestUrl, manifest) {
        try {
          const payload = {
            version: String(manifest?.version || ''),
            manifestUrl: String(manifestUrl || ''),
            manifest,
            savedAt: new Date().toISOString(),
          }
          localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
        } catch {}
      }

      async function resolveManifest(latestUrlOrManifestUrl, pinnedVersion) {
        const u = new URL(latestUrlOrManifestUrl, location.href)

        // 固定版本：直接从同源“CDN 根”下的 releases/<ver>/manifest.json 读取
        if (pinnedVersion) {
          // 允许直接给 manifest.json（调试/私有源）
          if (u.pathname.endsWith('.json') && u.pathname.toLowerCase().endsWith('manifest.json')) {
            const manifest = await fetchJson(u.toString())
            return { manifest, manifestUrl: u.toString() }
          }

          const manifestUrl = new URL('releases/' + pinnedVersion + '/manifest.json', u).toString()
          const manifest = await fetchJson(manifestUrl)
          return { manifest, manifestUrl }
        }

        const data = await fetchJson(u.toString())

        // 兼容：直接给 manifest.json
        if (data && data.files && data.entry) {
          return { manifest: data, manifestUrl: u.toString() }
        }

        const releasePath = String(data?.release?.path || '').replace(new RegExp('^/+'), '')
        const manifestRel = String(data?.release?.manifest || 'manifest.json').replace(new RegExp('^/+'), '')
        const base = releasePath
          ? new URL(releasePath.replace(new RegExp('/+$'), '') + '/', u).toString()
          : u.toString().replace(/[^/]*$/, '')
        const manifestUrl = new URL(manifestRel, base).toString()

        const manifest = await fetchJson(manifestUrl)
        return { manifest, manifestUrl }
      }

      function fileMap(manifest) {
        const map = new Map()
        for (const f of (manifest.files || [])) {
          if (f?.path) map.set(String(f.path), f)
        }
        return map
      }

      function normalizeRelPath(p) {
        let s = String(p || '').trim()
        while (s.startsWith('/')) s = s.slice(1)
        if (s.startsWith('./')) s = s.slice(2)
        return s
      }

      function loadAssets(manifestUrl, manifest) {
        const base = manifestUrl.replace(/[^/]*$/, '')
        const entry = manifest.entry || {}
        const jsList = Array.isArray(entry.js) ? entry.js : (entry.js ? [entry.js] : [])
        const cssList = Array.isArray(entry.css) ? entry.css : (entry.css ? [entry.css] : [])

        const files = fileMap(manifest)

        for (const href0 of cssList) {
          const rel = normalizeRelPath(href0)
          const href = new URL(rel, base).toString()
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = href
          const meta = files.get(rel)
          if (meta?.integrity) {
            link.integrity = String(meta.integrity)
            link.crossOrigin = 'anonymous'
          }
          document.head.appendChild(link)
        }

        for (const src0 of jsList) {
          const rel = normalizeRelPath(src0)
          const src = new URL(rel, base).toString()
          const script = document.createElement('script')
          script.type = 'module'
          script.src = src
          const meta = files.get(rel)
          if (meta?.integrity) {
            script.integrity = String(meta.integrity)
            script.crossOrigin = 'anonymous'
          }
          document.head.appendChild(script)
        }
      }

      async function tryBoot() {
        setError('')

        const qs = new URLSearchParams(location.search)
        const config = await tryLoadConfig()
        if (config?.latestUrl && !localStorage.getItem(STORAGE_KEY) && !(qs.get('latest') || qs.get('manifest'))) {
          els.input.value = String(config.latestUrl || '').trim()
        }
        if (config?.pinnedVersion && !localStorage.getItem(PIN_KEY)) {
          els.pin.value = normalizePinnedVersion(config.pinnedVersion)
        }

        const pinnedFromQuery = normalizePinnedVersion(qs.get('ver') || qs.get('version') || qs.get('tag') || '')
        const pinnedFromStorage = normalizePinnedVersion(localStorage.getItem(PIN_KEY) || '')
        const pinnedFromConfig = normalizePinnedVersion(config?.pinnedVersion || '')
        const pinnedVersion = pinnedFromQuery || pinnedFromStorage || pinnedFromConfig

        const candidates = pickCandidates(config)
        if (candidates.length === 0) {
          setStatus('未配置 latest.json；请手动填写并保存')
          return
        }

        if (pinnedVersion) {
          setStatus('固定版本：' + pinnedVersion + '（探测 CDN）…')
        }

        // SWR：无固定版本时，优先尝试从本地缓存启动，再后台探测更新。
        if (!pinnedVersion) {
          const cached = readCachedManifest()
          if (cached?.manifestUrl && cached?.manifest) {
            const cachedVersion = String(cached.version || cached.manifest?.version || 'unknown')
            setStatus('离线缓存启动：' + cachedVersion)
            loadAssets(String(cached.manifestUrl), cached.manifest)

            void (async () => {
              if (sessionStorage.getItem(RELOAD_ONCE_KEY)) return
              try {
                for (const url of candidates) {
                  try {
                    const { manifest, manifestUrl } = await resolveManifest(url, '')
                    const nextVersion = String(manifest?.version || 'unknown')
                    writeCachedManifest(manifestUrl, manifest)
                    if (nextVersion && cachedVersion && nextVersion !== cachedVersion) {
                      sessionStorage.setItem(RELOAD_ONCE_KEY, '1')
                      location.reload()
                    }
                    return
                  } catch {}
                }
              } catch {}
            })()

            return
          }

          setStatus('探测更新源…')
        }

        let lastErr = null
        for (const url of candidates) {
          try {
            setStatus('读取：' + url)
            const { manifest, manifestUrl } = await resolveManifest(url, pinnedVersion)
            writeCachedManifest(manifestUrl, manifest)
            setStatus('加载资源：' + (manifest?.version || pinnedVersion || 'unknown'))
            loadAssets(manifestUrl, manifest)
            return
          } catch (e) {
            lastErr = e
          }
        }

        setStatus('启动失败')
        setError(lastErr ? (lastErr?.stack || lastErr?.message || String(lastErr)) : 'unknown error')
      }

      function saveUrl() {
        const v = String(els.input.value || '').trim()
        if (!v) return
        localStorage.setItem(STORAGE_KEY, v)
        setStatus('已保存，点击“加载”尝试启动')
      }

      function pinVersion() {
        const v = normalizePinnedVersion(els.pin.value || '')
        if (!v) return
        localStorage.setItem(PIN_KEY, v)
        location.reload()
      }

      function unpinVersion() {
        localStorage.removeItem(PIN_KEY)
        els.pin.value = ''
        location.reload()
      }

      // 初始化
      els.input.value = String(localStorage.getItem(STORAGE_KEY) || DEFAULT_CANDIDATES[0] || '').trim()
      els.pin.value = String(localStorage.getItem(PIN_KEY) || '').trim()
      els.save.addEventListener('click', saveUrl)
      els.load.addEventListener('click', tryBoot)
      els.pinBtn.addEventListener('click', pinVersion)
      els.unpinBtn.addEventListener('click', unpinVersion)

      // 自动尝试启动（允许 query 参数覆盖）
      void tryBoot()
    </script>
  </body>
</html>`
}

async function buildManifest({ releaseDir, version, name, commit, builtAtIso }) {
  const entry = await resolveEntryAssets(releaseDir)

  const allFiles = await listFilesRecursive(releaseDir)

  const files = []
  for (const absPath of allFiles) {
    const rel = normalizeRelPath(path.relative(releaseDir, absPath))
    if (!rel) continue
    if (rel === 'manifest.json') continue
    if (rel === 'dist.zip') continue

    const buf = await fs.readFile(absPath)
    const sha256b64 = sha256Base64(buf)
    files.push({
      path: rel,
      size: buf.byteLength,
      sha256: sha256Hex(buf),
      integrity: toIntegrity(sha256b64),
    })
  }

  files.sort((a, b) => a.path.localeCompare(b.path))

  const manifest = {
    schema: 1,
    name,
    channel: CHANNEL,
    version,
    commit,
    builtAt: builtAtIso,
    entry: {
      html: 'index.html',
      js: entry.js,
      css: entry.css,
    },
    files,
  }

  await fs.writeFile(path.join(releaseDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return manifest
}

async function zipRelease({ releaseDir, outZipPath }) {
  await fs.rm(outZipPath, { force: true })

  if (process.platform === 'win32') {
    const ps = [
      'powershell',
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path "${releaseDir}\\*" -DestinationPath "${outZipPath}" -Force`,
    ]
    const res = spawnSync(ps[0], ps.slice(1), { stdio: 'inherit' })
    if (res.status !== 0) throw new Error('Compress-Archive failed')
    return
  }

  // linux/mac: use zip CLI
  const res = spawnSync('zip', ['-r', '-q', outZipPath, '.'], { cwd: releaseDir, stdio: 'inherit' })
  if (res.status !== 0) throw new Error('zip failed (missing zip?)')
}

async function main() {
  const pkgRaw = await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')
  const pkg = JSON.parse(pkgRaw)
  const name = String(pkg.name || 'torrent-webui')
  const version = String(pkg.version || '0.0.0')

  let commit = 'unknown'
  try {
    commit = runCapture('git rev-parse --short HEAD')
  } catch {}

  const builtAtIso = new Date().toISOString()
  const releaseDir = path.join(OUT_DIR, 'releases', version)

  await ensureEmptyDir(OUT_DIR)
  await fs.mkdir(path.dirname(releaseDir), { recursive: true })

	  console.log(`[publish] build core dist… (${name}@${version} ${commit})`)
	  run('pnpm run build', { cwd: ROOT })

  console.log('[publish] stage release dir…')
  await ensureEmptyDir(releaseDir)
  await copyDir(DIST_DIR, releaseDir)

  console.log('[publish] generate loader.html…')
  {
    const loader = buildLoaderHtml()
    await fs.writeFile(path.join(releaseDir, 'loader.html'), loader, 'utf8')
    await fs.writeFile(path.join(OUT_DIR, 'loader.html'), loader, 'utf8')
  }

  console.log('[publish] generate manifest.json…')
  const manifest = await buildManifest({ releaseDir, version, name, commit, builtAtIso })

  console.log('[publish] zip dist.zip…')
  const tmpZip = path.join(OUT_DIR, 'dist.zip')
  await zipRelease({ releaseDir, outZipPath: tmpZip })
  const zipBuf = await fs.readFile(tmpZip)
  const zipSha256 = sha256Hex(zipBuf)
  await fs.rename(tmpZip, path.join(releaseDir, 'dist.zip'))

  console.log('[publish] write latest.json…')
  const latest = {
    schema: 2,
    name,
    channel: CHANNEL,
    version,
    commit,
    builtAt: builtAtIso,
    release: {
      // A 模式（Loader）专用：latest.json 作为 CDN 入口，后续资产按 releases/<version>/manifest.json 从同一 CDN 读取。
      // 注意：保持 distZip 为相对 latest.json 的路径，方便 sidecar 等工具复用。
      path: `releases/${version}/`,
      manifest: 'manifest.json',
      loader: 'loader.html',
      distZip: `releases/${version}/dist.zip`,
      distZipSha256: zipSha256,
    },
  }
  await fs.writeFile(path.join(OUT_DIR, 'latest.json'), JSON.stringify(latest, null, 2) + '\n', 'utf8')

  // Extra copies for convenience (CI upload / manual download)
  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  console.log('[publish] done')
  console.log(`- ${path.relative(ROOT, OUT_DIR)}`)
  console.log(`- releases/${version}/dist.zip sha256=${zipSha256}`)
}

await main()
