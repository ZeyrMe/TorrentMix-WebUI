<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useBackendStore } from '@/store/backend'
import type {
  AppLogEntry,
  BackendCapabilities,
  PeerLogEntry,
  RssItems,
  RssRuleDefinition,
  SearchJobStatus,
  SearchPlugin,
  SearchResults,
} from '@/adapter/interface'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'
import { useUiOverlay } from '@/composables/useUiOverlay'
import { useModalKeyboard } from '@/composables/useModalKeyboard'

interface Props {
  open: boolean
}

interface Emits {
  (e: 'close'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const backendStore = useBackendStore()
const adapter = computed(() => backendStore.adapter)
const overlay = useUiOverlay()
const panelRef = ref<HTMLElement | null>(null)
useModalKeyboard(panelRef, () => emit('close'), computed(() => props.open))
const capabilities = computed<BackendCapabilities>(() => backendStore.capabilities)

type TabId = 'logs' | 'rss' | 'search'
const tabs = computed(() => {
  const caps = capabilities.value
  return [
    { id: 'logs' as const, label: 'Logs', icon: 'activity', visible: !!caps?.hasLogs },
    { id: 'rss' as const, label: 'RSS', icon: 'wifi', visible: !!caps?.hasRss },
    { id: 'search' as const, label: 'Search', icon: 'search', visible: !!caps?.hasSearch },
  ].filter(t => t.visible)
})

const activeTab = ref<TabId>('logs')
watch(tabs, (next) => {
  if (next.length === 0) return
  if (!next.some(t => t.id === activeTab.value)) {
    activeTab.value = next[0]!.id
  }
}, { immediate: true })

const loading = ref(false)
const error = ref('')

watch(() => props.open, (open) => {
  if (!open) return
  error.value = ''
})

function formatTimestamp(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return '--'
  const ms = ts > 100000000000 ? ts : ts * 1000
  return new Date(ms).toLocaleString()
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2)
}

async function run<T>(fn: () => Promise<T>, onSuccess: (result: T) => void) {
  if (!adapter.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await fn()
    onSuccess(result)
  } catch (err) {
    console.error('[ToolsDialog] Action failed:', err)
    error.value = err instanceof Error ? err.message : '操作失败'
  } finally {
    loading.value = false
  }
}

// ========== Logs ==========
const logTab = ref<'app' | 'peer'>('app')
const logFilters = ref({
  normal: true,
  info: true,
  warning: true,
  critical: true,
})
const appLogs = ref<AppLogEntry[]>([])
const peerLogs = ref<PeerLogEntry[]>([])

async function loadAppLog() {
  if (!adapter.value?.getAppLog) return
  await run(
    () => adapter.value!.getAppLog!({ ...logFilters.value, lastKnownId: -1 }),
    (items) => { appLogs.value = items },
  )
}

async function loadPeerLog() {
  if (!adapter.value?.getPeerLog) return
  await run(
    () => adapter.value!.getPeerLog!({ lastKnownId: -1 }),
    (items) => { peerLogs.value = items },
  )
}

// ========== RSS ==========
const rssWithData = ref(true)
const rssItems = ref<RssItems | null>(null)
const rssRules = ref<Record<string, RssRuleDefinition> | null>(null)
const rssMatching = ref<Record<string, string[]> | null>(null)

const rssAddFolderPath = ref('')
const rssAddFeedUrl = ref('')
const rssAddFeedPath = ref('')
const rssItemPath = ref('')
const rssDestPath = ref('')
const rssMarkArticleId = ref('')

const rssRuleName = ref('')
const rssRuleDefJson = ref('{\n  \"enabled\": true\n}')

async function rssGetItems() {
  if (!adapter.value?.rssGetItems) return
  await run(
    () => adapter.value!.rssGetItems!(rssWithData.value),
    (items) => { rssItems.value = items },
  )
}

async function rssGetRules() {
  if (!adapter.value?.rssGetRules) return
  await run(
    () => adapter.value!.rssGetRules!(),
    (rules) => { rssRules.value = rules },
  )
}

async function rssMatchingArticles() {
  if (!adapter.value?.rssMatchingArticles) return
  const name = rssRuleName.value.trim()
  if (!name) return
  await run(
    () => adapter.value!.rssMatchingArticles!(name),
    (result) => { rssMatching.value = result },
  )
}

async function rssAddFolder() {
  if (!adapter.value?.rssAddFolder) return
  const path = rssAddFolderPath.value.trim()
  if (!path) return
  await run(
    () => adapter.value!.rssAddFolder!(path),
    () => {},
  )
  await rssGetItems()
}

async function rssAddFeed() {
  if (!adapter.value?.rssAddFeed) return
  const url = rssAddFeedUrl.value.trim()
  const path = rssAddFeedPath.value.trim()
  if (!url) return
  await run(
    () => adapter.value!.rssAddFeed!(url, path || undefined),
    () => {},
  )
  await rssGetItems()
}

async function rssRemoveItem() {
  if (!adapter.value?.rssRemoveItem) return
  const path = rssItemPath.value.trim()
  if (!path) return
  const confirmed = await overlay.confirm({
    title: '移除 RSS 订阅',
    message: `确定移除 "${path}" 吗？`,
    confirmLabel: '移除',
    cancelLabel: '取消',
    tone: 'danger',
  })
  if (!confirmed) return
  await run(
    () => adapter.value!.rssRemoveItem!(path),
    () => {},
  )
  await rssGetItems()
}

async function rssMoveItem() {
  if (!adapter.value?.rssMoveItem) return
  const itemPath = rssItemPath.value.trim()
  const destPath = rssDestPath.value.trim()
  if (!itemPath || !destPath) return
  await run(
    () => adapter.value!.rssMoveItem!(itemPath, destPath),
    () => {},
  )
  await rssGetItems()
}

async function rssRefreshItem() {
  if (!adapter.value?.rssRefreshItem) return
  const path = rssItemPath.value.trim()
  if (!path) return
  await run(
    () => adapter.value!.rssRefreshItem!(path),
    () => {},
  )
  await rssGetItems()
}

async function rssMarkAsRead() {
  if (!adapter.value?.rssMarkAsRead) return
  const path = rssItemPath.value.trim()
  const articleId = rssMarkArticleId.value.trim()
  if (!path) return
  await run(
    () => adapter.value!.rssMarkAsRead!(path, articleId || undefined),
    () => {},
  )
  await rssGetItems()
}

async function rssSetRule() {
  if (!adapter.value?.rssSetRule) return
  const name = rssRuleName.value.trim()
  if (!name) return
  let def: RssRuleDefinition
  try {
    def = JSON.parse(rssRuleDefJson.value || '{}') as RssRuleDefinition
  } catch (err) {
    overlay.notify({ message: err instanceof Error ? err.message : 'ruleDef 不是合法 JSON', tone: 'danger' })
    return
  }
  await run(
    () => adapter.value!.rssSetRule!(name, def),
    () => {},
  )
  await rssGetRules()
}

async function rssRenameRule() {
  if (!adapter.value?.rssRenameRule) return
  const name = rssRuleName.value.trim()
  if (!name) return
  const values = await overlay.openForm({
    title: '重命名规则',
    fields: [{ key: 'name', label: '新的 ruleName', defaultValue: name, required: true }],
  })
  if (!values) return
  const trimmed = (values.name ?? '').trim()
  if (!trimmed || trimmed === name) return
  await run(
    () => adapter.value!.rssRenameRule!(name, trimmed),
    () => {},
  )
  rssRuleName.value = trimmed
  await rssGetRules()
}

async function rssRemoveRule() {
  if (!adapter.value?.rssRemoveRule) return
  const name = rssRuleName.value.trim()
  if (!name) return
  const confirmed = await overlay.confirm({
    title: '删除 RSS 规则',
    message: `确定删除规则 "${name}" 吗？`,
    confirmLabel: '删除',
    cancelLabel: '取消',
    tone: 'danger',
  })
  if (!confirmed) return
  await run(
    () => adapter.value!.rssRemoveRule!(name),
    () => {},
  )
  await rssGetRules()
}

// ========== Search ==========
const searchPlugins = ref<SearchPlugin[]>([])
const searchStatus = ref<SearchJobStatus[]>([])
const searchResults = ref<SearchResults | null>(null)

const searchPattern = ref('')
const searchPluginsInput = ref('enabled')
const searchCategoryInput = ref('all')

const searchJobId = ref('')
const searchOffset = ref(0)
const searchLimit = ref(50)

async function searchLoadPlugins() {
  if (!adapter.value?.searchPlugins) return
  await run(
    () => adapter.value!.searchPlugins!(),
    (items) => { searchPlugins.value = items },
  )
}

async function searchUpdatePlugins() {
  if (!adapter.value?.searchUpdatePlugins) return
  await run(
    () => adapter.value!.searchUpdatePlugins!(),
    () => {},
  )
  await searchLoadPlugins()
}

async function searchStart() {
  if (!adapter.value?.searchStart) return
  const pattern = searchPattern.value.trim()
  if (!pattern) return
  await run(
    () => adapter.value!.searchStart!({
      pattern,
      plugins: searchPluginsInput.value.trim() || 'enabled',
      category: searchCategoryInput.value.trim() || 'all',
    }),
    (id) => { searchJobId.value = String(id) },
  )
  await searchGetStatus()
}

function parseJobId(): number | null {
  const n = Number(searchJobId.value.trim())
  if (!Number.isFinite(n) || n < 0) return null
  return Math.floor(n)
}

async function searchGetStatus() {
  if (!adapter.value?.searchStatus) return
  const id = parseJobId()
  await run(
    () => adapter.value!.searchStatus!(id === null ? undefined : id),
    (items) => { searchStatus.value = items },
  )
}

async function searchStop() {
  if (!adapter.value?.searchStop) return
  const id = parseJobId()
  if (id === null) return
  await run(
    () => adapter.value!.searchStop!(id),
    () => {},
  )
  await searchGetStatus()
}

async function searchDelete() {
  if (!adapter.value?.searchDelete) return
  const id = parseJobId()
  if (id === null) return
  await run(
    () => adapter.value!.searchDelete!(id),
    () => {},
  )
  searchResults.value = null
  await searchGetStatus()
}

async function searchGetResults() {
  if (!adapter.value?.searchResults) return
  const id = parseJobId()
  if (id === null) return
  await run(
    () => adapter.value!.searchResults!({
      id,
      limit: Math.max(1, searchLimit.value),
      offset: Math.max(0, searchOffset.value),
    }),
    (result) => { searchResults.value = result },
  )
}

async function searchEnablePlugin(pluginName: string, enable: boolean) {
  if (!adapter.value?.searchEnablePlugin) return
  await run(
    () => adapter.value!.searchEnablePlugin!([pluginName], enable),
    () => {},
  )
  await searchLoadPlugins()
}

async function searchInstallPlugin() {
  if (!adapter.value?.searchInstallPlugin) return
  const values = await overlay.openForm({
    title: '安装搜索插件',
    fields: [{ key: 'sources', label: '插件源（URL 或本地路径，多条可用换行分隔）', multiline: true, required: true }],
  })
  if (!values) return
  const sources = (values.sources ?? '')
    .split(/[\n,，]+/g)
    .map(s => s.trim())
    .filter(Boolean)
  if (sources.length === 0) return
  await run(
    () => adapter.value!.searchInstallPlugin!(sources),
    () => {},
  )
  await searchLoadPlugins()
}

async function searchUninstallPlugin() {
  if (!adapter.value?.searchUninstallPlugin) return
  const values = await overlay.openForm({
    title: '卸载搜索插件',
    fields: [{ key: 'names', label: '插件 name（多条可用换行分隔）', multiline: true, required: true }],
  })
  if (!values) return
  const names = (values.names ?? '')
    .split(/[\n,，]+/g)
    .map(s => s.trim())
    .filter(Boolean)
  if (names.length === 0) return
  await run(
    () => adapter.value!.searchUninstallPlugin!(names),
    () => {},
  )
  await searchLoadPlugins()
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        @click.self="emit('close')"
      >
        <Transition
          enter-active-class="transition-all duration-200"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition-all duration-200"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-if="open"
            ref="panelRef"
            tabindex="-1"
            role="dialog"
            aria-modal="true"
            aria-label="工具"
            class="bg-white rounded-xl shadow-xl w-full max-w-5xl overflow-hidden outline-none"
            @click.stop
          >
            <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">工具</h2>
              <button
                @click="emit('close')"
                class="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <Icon name="x" :size="20" class="text-slate-500" />
              </button>
            </div>

            <div class="px-6 pt-4">
              <nav class="flex gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                <button
                  v-for="tab in tabs"
                  :key="tab.id"
                  @click="activeTab = tab.id"
                  :class="[
                    'flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors whitespace-nowrap',
                    activeTab === tab.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  ]"
                >
                  <Icon :name="tab.icon" :size="14" />
                  <span>{{ tab.label }}</span>
                </button>
              </nav>
            </div>

            <div class="px-6 py-4 space-y-4">
              <div v-if="error" class="text-sm text-red-600">
                {{ error }}
              </div>

              <div v-if="loading" class="text-sm text-slate-500 flex items-center gap-2">
                <Icon name="loader-2" :size="16" class="animate-spin" />
                <span>执行中...</span>
              </div>

              <!-- Logs -->
              <div v-if="activeTab === 'logs'" class="space-y-4">
                <div class="flex flex-wrap items-center gap-2">
                  <button class="btn" :class="logTab === 'app' ? 'btn-primary' : ''" @click="logTab = 'app'">
                    应用日志
                  </button>
                  <button class="btn" :class="logTab === 'peer' ? 'btn-primary' : ''" @click="logTab = 'peer'">
                    Peer 日志
                  </button>
                  <button v-if="logTab === 'app'" class="btn ml-auto" @click="loadAppLog" :disabled="loading">
                    加载
                  </button>
                  <button v-else class="btn ml-auto" @click="loadPeerLog" :disabled="loading">
                    加载
                  </button>
                </div>

                <div v-if="logTab === 'app'" class="space-y-3">
                  <div class="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                    <label class="inline-flex items-center gap-2">
                      <input v-model="logFilters.normal" type="checkbox" class="h-4 w-4" />
                      normal
                    </label>
                    <label class="inline-flex items-center gap-2">
                      <input v-model="logFilters.info" type="checkbox" class="h-4 w-4" />
                      info
                    </label>
                    <label class="inline-flex items-center gap-2">
                      <input v-model="logFilters.warning" type="checkbox" class="h-4 w-4" />
                      warning
                    </label>
                    <label class="inline-flex items-center gap-2">
                      <input v-model="logFilters.critical" type="checkbox" class="h-4 w-4" />
                      critical
                    </label>
                    <button class="btn ml-auto" @click="loadAppLog" :disabled="loading">应用过滤</button>
                  </div>

                  <div class="border border-slate-200 rounded-lg overflow-hidden">
                    <div class="max-h-[55vh] overflow-auto">
                      <div
                        v-for="entry in appLogs"
                        :key="entry.id"
                        class="px-4 py-2 border-b border-slate-100 text-sm"
                      >
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span class="font-mono text-xs text-slate-500">#{{ entry.id }}</span>
                          <span class="font-mono text-xs text-slate-500">{{ formatTimestamp(entry.timestamp) }}</span>
                          <span class="text-xs font-medium text-slate-700">{{ entry.level }}</span>
                        </div>
                        <SafeText as="div" class="mt-1 text-slate-800 whitespace-pre-wrap break-words" :text="entry.message" />
                      </div>
                      <div v-if="appLogs.length === 0" class="px-4 py-8 text-center text-sm text-slate-500">
                        暂无日志
                      </div>
                    </div>
                  </div>
                </div>

                <div v-else class="space-y-3">
                  <div class="border border-slate-200 rounded-lg overflow-hidden">
                    <div class="max-h-[55vh] overflow-auto">
                      <div
                        v-for="entry in peerLogs"
                        :key="entry.id"
                        class="px-4 py-2 border-b border-slate-100 text-sm"
                      >
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span class="font-mono text-xs text-slate-500">#{{ entry.id }}</span>
                          <span class="font-mono text-xs text-slate-500">{{ formatTimestamp(entry.timestamp) }}</span>
                          <span class="font-mono text-xs text-slate-700">{{ entry.ip }}</span>
                          <span class="text-xs font-medium" :class="entry.blocked ? 'text-red-700' : 'text-slate-600'">
                            {{ entry.blocked ? 'blocked' : 'ok' }}
                          </span>
                        </div>
                        <SafeText as="div" class="mt-1 text-slate-800 whitespace-pre-wrap break-words" :text="entry.reason" />
                      </div>
                      <div v-if="peerLogs.length === 0" class="px-4 py-8 text-center text-sm text-slate-500">
                        暂无 Peer 日志
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- RSS -->
              <div v-else-if="activeTab === 'rss'" class="space-y-4">
                <div class="flex flex-wrap items-center gap-2">
                  <label class="inline-flex items-center gap-2 text-sm text-slate-600">
                    <input v-model="rssWithData" type="checkbox" class="h-4 w-4" />
                    withData
                  </label>
                  <button class="btn" @click="rssGetItems" :disabled="loading">获取 items</button>
                  <button class="btn" @click="rssGetRules" :disabled="loading">获取 rules</button>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div class="space-y-4">
                    <div class="card p-4 space-y-3">
                      <h3 class="text-sm font-semibold text-slate-900">订阅源管理</h3>
                      <div class="space-y-2">
                        <label class="block text-xs font-medium text-slate-600">addFolder path（使用 \\ 分隔）</label>
                        <input v-model="rssAddFolderPath" class="input font-mono" placeholder="The Pirate Bay\\Top100" />
                        <button class="btn" @click="rssAddFolder" :disabled="loading">添加文件夹</button>
                      </div>
                      <div class="space-y-2">
                        <label class="block text-xs font-medium text-slate-600">addFeed url</label>
                        <input v-model="rssAddFeedUrl" class="input font-mono" placeholder="https://example.com/rss" />
                        <label class="block text-xs font-medium text-slate-600">addFeed path（可选）</label>
                        <input v-model="rssAddFeedPath" class="input font-mono" placeholder="The Pirate Bay\\Top100\\Video" />
                        <button class="btn" @click="rssAddFeed" :disabled="loading">添加 Feed</button>
                      </div>
                      <div class="space-y-2">
                        <label class="block text-xs font-medium text-slate-600">itemPath（remove/move/refresh/markAsRead）</label>
                        <input v-model="rssItemPath" class="input font-mono" placeholder="The Pirate Bay\\Top100\\Video" />
                        <div class="flex flex-wrap gap-2">
                          <button class="btn" @click="rssRefreshItem" :disabled="loading">刷新 item</button>
                          <button class="btn btn-destructive" @click="rssRemoveItem" :disabled="loading">移除 item</button>
                        </div>
                        <label class="block text-xs font-medium text-slate-600">destPath（moveItem）</label>
                        <input v-model="rssDestPath" class="input font-mono" placeholder="The Pirate Bay\\Top100" />
                        <button class="btn" @click="rssMoveItem" :disabled="loading">移动/重命名</button>
                        <label class="block text-xs font-medium text-slate-600">articleId（可选：markAsRead）</label>
                        <input v-model="rssMarkArticleId" class="input font-mono" placeholder="留空表示整 Feed 已读" />
                        <button class="btn" @click="rssMarkAsRead" :disabled="loading">标记已读</button>
                      </div>
                    </div>

                    <div class="card p-4 space-y-3">
                      <h3 class="text-sm font-semibold text-slate-900">规则管理</h3>
                      <div class="space-y-2">
                        <label class="block text-xs font-medium text-slate-600">ruleName</label>
                        <input v-model="rssRuleName" class="input font-mono" placeholder="Punisher" />
                        <label class="block text-xs font-medium text-slate-600">ruleDef（JSON）</label>
                        <textarea v-model="rssRuleDefJson" class="input font-mono h-24 resize-none" />
                        <div class="flex flex-wrap gap-2">
                          <button class="btn btn-primary" @click="rssSetRule" :disabled="loading">保存 rule</button>
                          <button class="btn" @click="rssRenameRule" :disabled="loading">重命名 rule</button>
                          <button class="btn btn-destructive" @click="rssRemoveRule" :disabled="loading">删除 rule</button>
                          <button class="btn" @click="rssMatchingArticles" :disabled="loading">matchingArticles</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="space-y-4">
                    <div class="card p-4 space-y-2">
                      <h3 class="text-sm font-semibold text-slate-900">items</h3>
                      <pre class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs overflow-auto max-h-64">{{ pretty(rssItems) }}</pre>
                    </div>
                    <div class="card p-4 space-y-2">
                      <h3 class="text-sm font-semibold text-slate-900">rules</h3>
                      <pre class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs overflow-auto max-h-64">{{ pretty(rssRules) }}</pre>
                    </div>
                    <div class="card p-4 space-y-2">
                      <h3 class="text-sm font-semibold text-slate-900">matchingArticles</h3>
                      <pre class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs overflow-auto max-h-64">{{ pretty(rssMatching) }}</pre>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Search -->
              <div v-else-if="activeTab === 'search'" class="space-y-4">
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div class="space-y-4">
                    <div class="card p-4 space-y-3">
                      <h3 class="text-sm font-semibold text-slate-900">启动搜索</h3>
                      <div class="space-y-2">
                        <label class="block text-xs font-medium text-slate-600">pattern</label>
                        <input v-model="searchPattern" class="input font-mono" placeholder="Ubuntu 24.04" />
                        <label class="block text-xs font-medium text-slate-600">plugins（支持 | 分隔，all/enabled）</label>
                        <input v-model="searchPluginsInput" class="input font-mono" placeholder="enabled" />
                        <label class="block text-xs font-medium text-slate-600">category（all 或具体分类）</label>
                        <input v-model="searchCategoryInput" class="input font-mono" placeholder="all" />
                        <button class="btn btn-primary" @click="searchStart" :disabled="loading || !searchPattern.trim()">开始</button>
                      </div>
                    </div>

                    <div class="card p-4 space-y-3">
                      <h3 class="text-sm font-semibold text-slate-900">任务与结果</h3>
                      <div class="space-y-2">
                        <label class="block text-xs font-medium text-slate-600">job id</label>
                        <input v-model="searchJobId" class="input font-mono" placeholder="例如 12345" />
                        <div class="flex flex-wrap gap-2">
                          <button class="btn" @click="searchGetStatus" :disabled="loading">status</button>
                          <button class="btn" @click="searchStop" :disabled="loading">stop</button>
                          <button class="btn btn-destructive" @click="searchDelete" :disabled="loading">delete</button>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <label class="block text-xs font-medium text-slate-600">offset</label>
                            <input v-model.number="searchOffset" type="number" class="input font-mono" min="0" />
                          </div>
                          <div>
                            <label class="block text-xs font-medium text-slate-600">limit</label>
                            <input v-model.number="searchLimit" type="number" class="input font-mono" min="1" />
                          </div>
                        </div>
                        <button class="btn" @click="searchGetResults" :disabled="loading">results</button>
                      </div>
                    </div>

                    <div class="card p-4 space-y-3">
                      <h3 class="text-sm font-semibold text-slate-900">插件管理</h3>
                      <div class="flex flex-wrap gap-2">
                        <button class="btn" @click="searchLoadPlugins" :disabled="loading">plugins</button>
                        <button class="btn" @click="searchUpdatePlugins" :disabled="loading">update</button>
                        <button class="btn" @click="searchInstallPlugin" :disabled="loading">install</button>
                        <button class="btn btn-destructive" @click="searchUninstallPlugin" :disabled="loading">uninstall</button>
                      </div>
                      <div v-if="searchPlugins.length > 0" class="text-xs text-slate-500">
                        点击 enabled 直接切换（逐个调用 enablePlugin）
                      </div>
                    </div>
                  </div>

                  <div class="space-y-4">
                    <div class="card p-4 space-y-2">
                      <h3 class="text-sm font-semibold text-slate-900">status</h3>
                      <pre class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs overflow-auto max-h-48">{{ pretty(searchStatus) }}</pre>
                    </div>
                    <div class="card p-4 space-y-2">
                      <h3 class="text-sm font-semibold text-slate-900">results</h3>
                      <pre class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs overflow-auto max-h-64">{{ pretty(searchResults) }}</pre>
                      <div v-if="searchResults?.results?.length" class="text-xs text-slate-500">
                        当前页：{{ searchResults.results.length }} 条，total: {{ searchResults.total }}
                      </div>
                    </div>
                    <div class="card p-4 space-y-2">
                      <h3 class="text-sm font-semibold text-slate-900">plugins</h3>
                      <div class="max-h-64 overflow-auto border border-slate-200 rounded-lg">
                        <div
                          v-for="p in searchPlugins"
                          :key="p.name"
                          class="px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-4"
                        >
                          <div class="min-w-0">
                            <div class="text-sm font-medium text-slate-900 truncate">{{ p.fullName || p.name }}</div>
                            <div class="text-xs text-slate-500 font-mono truncate">{{ p.name }} · v{{ p.version }}</div>
                          </div>
                          <label class="inline-flex items-center gap-2 text-sm text-slate-600 shrink-0">
                            <input
                              :checked="p.enabled"
                              type="checkbox"
                              class="h-4 w-4"
                              @change="searchEnablePlugin(p.name, ($event.target as HTMLInputElement).checked)"
                            />
                            enabled
                          </label>
                        </div>
                        <div v-if="searchPlugins.length === 0" class="px-4 py-8 text-center text-sm text-slate-500">
                          暂无插件
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="text-sm text-slate-500">
                当前后端不支持此功能
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
