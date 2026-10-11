import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { formatBytes, formatEta, formatSpeed, formatDuration } from '../src/utils/format.ts'
import {
  buildLatestMetadata,
  buildManifest,
  buildLoaderScript,
  getCanonicalReleaseFileSet,
  loaderLoadAssets,
  loaderPickCandidates,
  loaderResolveManifest,
  loaderResolvePinnedVersion,
  validateLatestReleaseContract,
  validateManifestContract,
} from '../scripts/release/build-publish.mjs'
import { installOnce, sha256Hex } from '../deploy/sidecar/updater.mjs'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENABLE_DISTRIBUTION_SMOKE = process.env.RUN_DISTRIBUTION_SMOKE === '1'

function createTempDir(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix))
}

async function writeFixtureReleaseDir(releaseDir: string) {
  await fs.mkdir(path.join(releaseDir, 'assets'), { recursive: true })
  await fs.writeFile(
    path.join(releaseDir, 'index.html'),
    [
      '<!doctype html>',
      '<html>',
      '  <head>',
      '    <link rel="stylesheet" href="/assets/app.css">',
      '  </head>',
      '  <body>',
      '    <script type="module" src="/assets/app.js"></script>',
      '  </body>',
      '</html>',
    ].join('\n'),
    'utf8',
  )
  await fs.writeFile(path.join(releaseDir, 'assets', 'app.css'), 'body { color: red; }\n', 'utf8')
  await fs.writeFile(path.join(releaseDir, 'assets', 'app.js'), 'console.log("fixture")\n', 'utf8')
}

function createFakeDocument() {
  const nodes: Array<Record<string, unknown>> = []
  return {
    nodes,
    head: {
      appendChild(node: Record<string, unknown>) {
        nodes.push({ ...node })
      },
    },
    createElement(tagName: string) {
      return { tagName }
    },
  }
}

function createFakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    setItem(key: string, value: string) {
      map.set(key, String(value))
    },
    removeItem(key: string) {
      map.delete(key)
    },
  }
}

function createFakeBrowserContext() {
  const document = createFakeDocument()
  const elements = new Map<string, any>()
  const getElement = (id: string) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: '',
        textContent: '',
        style: { display: 'none' },
        addEventListener() {},
      })
    }
    return elements.get(id)
  }

  const latest = {
    version: '0.1.0',
    release: {
      path: 'releases/0.1.0/',
      manifest: 'manifest.json',
    },
  }
  const manifest = {
    version: '0.1.0',
    entry: {
      js: ['assets/app.js'],
      css: ['assets/app.css'],
    },
    files: [
      { path: 'assets/app.js', integrity: 'sha256-script', sha256: 'a'.repeat(64), size: 10 },
      { path: 'assets/app.css', integrity: 'sha256-style', sha256: 'b'.repeat(64), size: 10 },
    ],
  }
  const fetchCalls: string[] = []
  const fetch = async (url: string) => {
    fetchCalls.push(url)
    if (url.endsWith('/config.json')) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }
    }
    if (url.endsWith('/latest.json')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => latest }
    }
    if (url.endsWith('/releases/0.1.0/manifest.json')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => manifest }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const context = vm.createContext({
    console,
    document: {
      ...document,
      getElementById: getElement,
    },
    localStorage: createFakeStorage(),
    sessionStorage: createFakeStorage(),
    location: {
      href: 'https://loader.example/index.html',
      search: '',
      reload() {},
    },
    fetch,
    AbortController,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Promise,
  })

  return {
    context,
    document,
    elements,
    fetchCalls,
  }
}

async function flushAsyncTurns(rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await new Promise(resolve => setImmediate(resolve))
  }
}

test('format: formatBytes should be stable for small/invalid numbers', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(0.5), '0 B')
  assert.equal(formatBytes(1), '1 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(-1), '--')
  assert.equal(formatBytes(Number.NaN), '--')
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), '--')
})

test('format: formatSpeed should not append /s for invalid bytes', () => {
  assert.equal(formatSpeed(0), '0 B/s')
  assert.equal(formatSpeed(1024), '1.0 KB/s')
  assert.equal(formatSpeed(Number.NaN), '--')
})

test('format: formatEta treats qBittorrent infinity sentinel as infinite', () => {
  assert.equal(formatEta(8640000, 0.5, 'downloading'), '∞')
  assert.equal(formatEta(-1, 0.5, 'downloading'), '∞')
  assert.equal(formatEta(8640000 - 1, 0.5, 'downloading'), '99天')
  assert.equal(formatEta(3600, 1, 'seeding'), '∞')
})

test('format: formatDuration should be stable for invalid/negative seconds', () => {
  assert.equal(formatDuration(-1), '∞')
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(59), '59s')
  assert.equal(formatDuration(60), '1m 0s')
  assert.equal(formatDuration(3600), '1h 0m')
  assert.equal(formatDuration(-5), '--')
  assert.equal(formatDuration(Number.NaN), '--')
})

test('distribution: latest metadata keeps release references relative and validated', () => {
  const latest = buildLatestMetadata({
    name: 'torrentmix-core',
    version: '0.1.0',
    commit: 'abc1234',
    builtAtIso: '2026-03-14T00:00:00.000Z',
    zipSha256: 'a'.repeat(64),
  })

  validateLatestReleaseContract(latest)
  assert.equal(latest.release.path, 'releases/0.1.0/')
  assert.equal(latest.release.manifest, 'manifest.json')
  assert.equal(latest.release.loader, 'loader.html')
  assert.equal(latest.release.distZip, 'releases/0.1.0/dist.zip')
})

test('distribution: buildManifest records relative entry assets and file integrity', async () => {
  const dir = createTempDir('torrentmix-manifest-')
  try {
    const releaseDir = path.join(dir, 'release')
    await writeFixtureReleaseDir(releaseDir)

    const manifest = await buildManifest({
      releaseDir,
      version: '0.1.0',
      name: 'torrentmix-core',
      commit: 'abc1234',
      builtAtIso: '2026-03-14T00:00:00.000Z',
    })

    validateManifestContract(manifest)
    assert.deepEqual(manifest.entry.js, ['assets/app.js'])
    assert.deepEqual(manifest.entry.css, ['assets/app.css'])

    const filePaths = new Set(manifest.files.map(file => file.path))
    assert.ok(filePaths.has('assets/app.js'))
    assert.ok(filePaths.has('assets/app.css'))
    assert.ok(filePaths.has('index.html'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('distribution: loader pinned-version precedence favors query over storage and config', () => {
  const pinned = loaderResolvePinnedVersion({
    search: '?tag=v1.2.3',
    storedValue: '2.0.0',
    configPinnedVersion: '3.0.0',
  })

  assert.equal(pinned, '1.2.3')
})

test('distribution: loader candidate precedence tries query before saved and configured sources', () => {
  const candidates = loaderPickCandidates({
    search: '?latest=https://query.example/latest.json',
    inputValue: 'https://input.example/latest.json',
    savedValue: 'https://saved.example/latest.json',
    configLatestUrl: 'https://config.example/latest.json',
    configCandidates: ['https://mirror.example/latest.json', 'https://saved.example/latest.json'],
    defaultCandidates: ['https://default.example/latest.json'],
  })

  assert.deepEqual(candidates, [
    'https://query.example/latest.json',
    'https://input.example/latest.json',
    'https://saved.example/latest.json',
    'https://config.example/latest.json',
    'https://mirror.example/latest.json',
    'https://default.example/latest.json',
    './latest.json',
  ])
})

test('distribution: loader resolves pinned manifest from release-relative path', async () => {
  const seen: string[] = []
  const result = await loaderResolveManifest({
    latestUrlOrManifestUrl: 'https://cdn.example/latest.json',
    pinnedVersion: '0.1.0',
    locationHref: 'https://loader.example/index.html',
    fetchJson: async (url: string) => {
      seen.push(url)
      return { version: '0.1.0', files: [], entry: { js: [], css: [] } }
    },
  })

  assert.equal(result.manifestUrl, 'https://cdn.example/releases/0.1.0/manifest.json')
  assert.deepEqual(seen, ['https://cdn.example/releases/0.1.0/manifest.json'])
})

test('distribution: loader injects manifest-relative assets and integrity metadata', () => {
  const doc = createFakeDocument()
  loaderLoadAssets({
    document: doc as any,
    manifestUrl: 'https://cdn.example/releases/0.1.0/manifest.json',
    manifest: {
      entry: {
        js: ['assets/app.js'],
        css: ['assets/app.css'],
      },
      files: [
        { path: 'assets/app.js', integrity: 'sha256-script', sha256: 'a'.repeat(64), size: 10 },
        { path: 'assets/app.css', integrity: 'sha256-style', sha256: 'b'.repeat(64), size: 10 },
      ],
    },
  })

  assert.equal(doc.nodes.length, 2)
  assert.deepEqual(doc.nodes[0], {
    tagName: 'link',
    rel: 'stylesheet',
    href: 'https://cdn.example/releases/0.1.0/assets/app.css',
    integrity: 'sha256-style',
    crossOrigin: 'anonymous',
  })
  assert.deepEqual(doc.nodes[1], {
    tagName: 'script',
    type: 'module',
    src: 'https://cdn.example/releases/0.1.0/assets/app.js',
    integrity: 'sha256-script',
    crossOrigin: 'anonymous',
  })
})

test('distribution: generated loader script boots unpinned flow and loads assets', async () => {
  const script = buildLoaderScript({ defaultCandidates: [] })
  const { context, document, elements, fetchCalls } = createFakeBrowserContext()

  vm.runInContext(script, context)
  await flushAsyncTurns()

  assert.equal(document.nodes.length, 2)
  assert.equal(elements.get('status')?.textContent, '状态：加载资源：0.1.0')
  assert.equal(elements.get('error')?.style.display, 'none')
  assert.deepEqual(fetchCalls, [
    'https://loader.example/config.json',
    'https://loader.example/latest.json',
    'https://loader.example/releases/0.1.0/manifest.json',
  ])
})

test('distribution: sidecar installs release, writes marker, and skips unchanged version', async () => {
  const dir = createTempDir('torrentmix-sidecar-ok-')
  try {
    const targetDir = path.join(dir, 'target')
    const tmpRoot = path.join(dir, 'tmp')
    await fs.mkdir(targetDir, { recursive: true })

    const zipBuf = Buffer.from('fake-zip-buffer')
    const latest = {
      version: '0.1.0',
      release: {
        distZip: 'releases/0.1.0/dist.zip',
        distZipSha256: sha256Hex(zipBuf),
      },
    }

    let downloadCalls = 0
    const overrides = {
      fetchJson: async () => latest,
      download: async (_url: string, outPath: string) => {
        downloadCalls++
        await fs.mkdir(path.dirname(outPath), { recursive: true })
        await fs.writeFile(outPath, zipBuf)
        return zipBuf
      },
      unzip: async (_zipPath: string, extractDir: string) => {
        await fs.mkdir(path.join(extractDir, 'assets'), { recursive: true })
        await fs.writeFile(path.join(extractDir, 'index.html'), 'ok', 'utf8')
        await fs.writeFile(path.join(extractDir, 'assets', 'app.js'), 'ok', 'utf8')
      },
      now: () => new Date('2026-03-14T00:00:00.000Z'),
    }

    const logger = { log() {}, error() {} }
    const first = await installOnce({
      latestUrl: 'https://release.example/latest.json',
      targetDir,
      tmpRoot,
      checkIntervalSec: 0,
      logger,
    }, overrides)
    assert.equal(first.status, 'installed')
    assert.equal(downloadCalls, 1)
    assert.ok(existsSync(path.join(targetDir, 'index.html')))

    const marker = JSON.parse(await fs.readFile(path.join(targetDir, '.webui-version.json'), 'utf8'))
    assert.equal(marker.version, '0.1.0')
    assert.equal(marker.installedAt, '2026-03-14T00:00:00.000Z')

    const second = await installOnce({
      latestUrl: 'https://release.example/latest.json',
      targetDir,
      tmpRoot,
      checkIntervalSec: 0,
      logger,
    }, overrides)
    assert.equal(second.status, 'up-to-date')
    assert.equal(downloadCalls, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('distribution: sidecar rejects checksum mismatch without clobbering target', async () => {
  const dir = createTempDir('torrentmix-sidecar-sha-')
  try {
    const targetDir = path.join(dir, 'target')
    const tmpRoot = path.join(dir, 'tmp')
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(targetDir, 'keep.txt'), 'keep', 'utf8')

    const zipBuf = Buffer.from('fake-zip-buffer')
    await assert.rejects(
      installOnce({
        latestUrl: 'https://release.example/latest.json',
        targetDir,
        tmpRoot,
        checkIntervalSec: 0,
        logger: { log() {}, error() {} },
      }, {
        fetchJson: async () => ({
          version: '0.1.0',
          release: {
            distZip: 'releases/0.1.0/dist.zip',
            distZipSha256: 'b'.repeat(64),
          },
        }),
        download: async (_url: string, outPath: string) => {
          await fs.mkdir(path.dirname(outPath), { recursive: true })
          await fs.writeFile(outPath, zipBuf)
          return zipBuf
        },
      }),
      /zip sha256 mismatch/,
    )

    assert.equal(await fs.readFile(path.join(targetDir, 'keep.txt'), 'utf8'), 'keep')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('distribution: sidecar rejects invalid archive layout without clobbering target', async () => {
  const dir = createTempDir('torrentmix-sidecar-layout-')
  try {
    const targetDir = path.join(dir, 'target')
    const tmpRoot = path.join(dir, 'tmp')
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(targetDir, 'keep.txt'), 'keep', 'utf8')

    const zipBuf = Buffer.from('fake-zip-buffer')
    await assert.rejects(
      installOnce({
        latestUrl: 'https://release.example/latest.json',
        targetDir,
        tmpRoot,
        checkIntervalSec: 0,
        logger: { log() {}, error() {} },
      }, {
        fetchJson: async () => ({
          version: '0.1.0',
          release: {
            distZip: 'releases/0.1.0/dist.zip',
            distZipSha256: sha256Hex(zipBuf),
          },
        }),
        download: async (_url: string, outPath: string) => {
          await fs.mkdir(path.dirname(outPath), { recursive: true })
          await fs.writeFile(outPath, zipBuf)
          return zipBuf
        },
        unzip: async (_zipPath: string, extractDir: string) => {
          await fs.mkdir(path.join(extractDir, 'nested'), { recursive: true })
          await fs.writeFile(path.join(extractDir, 'nested', 'index.html'), 'bad', 'utf8')
        },
      }),
      /invalid zip: index\.html not found at root/,
    )

    assert.equal(await fs.readFile(path.join(targetDir, 'keep.txt'), 'utf8'), 'keep')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('distribution smoke: publish output includes canonical top-level and versioned files', {
  skip: !ENABLE_DISTRIBUTION_SMOKE,
}, async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
  const outDir = path.join(PROJECT_ROOT, 'artifacts', 'publish')
  const { topLevel, versioned } = getCanonicalReleaseFileSet(String(pkg.version))

  for (const rel of [...topLevel, ...versioned]) {
    await fs.stat(path.join(outDir, rel))
  }

  const latest = JSON.parse(await fs.readFile(path.join(outDir, 'latest.json'), 'utf8'))
  validateLatestReleaseContract(latest)
  assert.equal(latest.release.path, `releases/${pkg.version}/`)
})

test('distribution smoke: dist zip extracts at root and matches manifest entry assets', {
  skip: !ENABLE_DISTRIBUTION_SMOKE,
}, async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
  const outDir = path.join(PROJECT_ROOT, 'artifacts', 'publish')
  const releaseDir = path.join(outDir, 'releases', String(pkg.version))
  const manifest = validateManifestContract(
    JSON.parse(await fs.readFile(path.join(releaseDir, 'manifest.json'), 'utf8')),
  )

  const extractDir = createTempDir('torrentmix-dist-smoke-')
  try {
    const zipPath = path.join(releaseDir, 'dist.zip')
    const res = spawnSync('unzip', ['-q', '-o', zipPath, '-d', extractDir], { encoding: 'utf8' })
    assert.equal(res.status, 0, res.stderr || res.stdout || 'unzip failed')

    await fs.stat(path.join(extractDir, 'index.html'))
    for (const rel of [...manifest.entry.js, ...manifest.entry.css]) {
      await fs.stat(path.join(extractDir, rel))
    }
  } finally {
    rmSync(extractDir, { recursive: true, force: true })
  }
})
