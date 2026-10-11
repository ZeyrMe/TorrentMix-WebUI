<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import { useModalKeyboard } from '@/composables/useModalKeyboard'
import Spinner from '@/components/ui/Spinner.vue'

type BackendType = 'qbit' | 'trans'

type StandaloneConfigServer = {
  id: string
  name: string
  type: BackendType
  baseUrl: string
  username: string
  hasPassword: boolean
}

type StandaloneConfig = {
  schema: number
  defaultServerId: string
  servers: StandaloneConfigServer[]
}

type ServerRow = StandaloneConfigServer & {
  uid: string
  password: string
  clearPassword: boolean
}

interface Props {
  open: boolean
}

interface Emits {
  (e: 'close'): void
  (e: 'saved'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const panelRef = ref<HTMLElement | null>(null)
useModalKeyboard(panelRef, () => emit('close'), computed(() => props.open))

const loading = ref(false)
const saving = ref(false)
const errorText = ref('')

const defaultServerId = ref('')
const servers = ref<ServerRow[]>([])

const canRemove = computed(() => servers.value.length > 1)

function uid() {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

function normalizeRow(row: Partial<StandaloneConfigServer>): ServerRow {
  return {
    uid: uid(),
    id: String(row.id ?? '').trim(),
    name: String(row.name ?? '').trim(),
    type: (row as any).type === 'trans' ? 'trans' : 'qbit',
    baseUrl: String(row.baseUrl ?? '').trim(),
    username: String(row.username ?? '').trim(),
    hasPassword: Boolean(row.hasPassword),
    password: '',
    clearPassword: false,
  }
}

function effectivePassword(row: ServerRow): string {
  if (row.clearPassword) return ''
  if (row.password.trim()) return row.password.trim()
  return row.hasPassword ? '***' : ''
}

function validate(): string | null {
  const list = servers.value
  if (list.length === 0) return '至少需要一个服务器。'

  const ids = new Set<string>()
  for (const s of list) {
    const id = s.id.trim()
    if (!id) return 'server.id 不能为空。'
    if (ids.has(id)) return `server.id 重复：${id}`
    ids.add(id)
    if (!s.baseUrl.trim()) return `server.baseUrl 不能为空（${id}）。`

    if (s.type === 'qbit') {
      const user = s.username.trim()
      const pass = effectivePassword(s)
      if (!user && !pass) return `qBittorrent 服务器需要 username/password（${id}）。`
    }
  }

  const def = defaultServerId.value.trim()
  if (def && !ids.has(def)) return 'defaultServerId 必须存在于 servers 中。'
  return null
}

async function load() {
  if (!props.open) return
  loading.value = true
  errorText.value = ''
  try {
    const res = await fetch('/__standalone__/config', { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as Partial<StandaloneConfig>
    if (!data || !Array.isArray(data.servers)) throw new Error('invalid response')

    defaultServerId.value = String(data.defaultServerId ?? '').trim()
    servers.value = (data.servers ?? []).map(v => normalizeRow(v))
    if (!servers.value.length) {
      servers.value = [normalizeRow({ type: 'qbit' } as any)]
    }
    if (!defaultServerId.value) {
      defaultServerId.value = servers.value[0]?.id ?? ''
    }
  } catch (err) {
    errorText.value = (err as any)?.message || String(err)
    servers.value = []
    defaultServerId.value = ''
  } finally {
    loading.value = false
  }
}

watch(() => props.open, (v) => {
  if (v) void load()
})

function addServer() {
  servers.value.push(normalizeRow({ type: 'qbit' } as any))
}

function removeServer(uid: string) {
  if (!canRemove.value) return
  servers.value = servers.value.filter(v => v.uid !== uid)
  if (servers.value.length && !servers.value.some(v => v.id === defaultServerId.value)) {
    defaultServerId.value = servers.value[0]?.id ?? ''
  }
}

function clearPassword(row: ServerRow) {
  row.password = ''
  row.clearPassword = true
  row.hasPassword = false
}

function buildPayload() {
  return {
    defaultServerId: defaultServerId.value.trim(),
    servers: servers.value.map(s => ({
      id: s.id.trim(),
      name: s.name.trim(),
      type: s.type,
      baseUrl: s.baseUrl.trim(),
      username: s.username.trim(),
      password: s.clearPassword ? '' : (s.password.trim() ? s.password.trim() : undefined),
    })),
  }
}

async function save() {
  const err = validate()
  if (err) {
    errorText.value = err
    return
  }

  saving.value = true
  errorText.value = ''
  try {
    const payload = buildPayload()
    const res = await fetch('/__standalone__/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `HTTP ${res.status}`)
    }
    emit('saved')
  } catch (err) {
    errorText.value = (err as any)?.message || String(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      @click.self="emit('close')"
    >
      <div
        ref="panelRef"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-label="服务器配置"
        class="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col outline-none"
      >
        <div class="px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-slate-900">服务器配置（Standalone）</h2>
          <button class="icon-btn" title="关闭" @click="emit('close')">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
          <div class="text-xs text-slate-500">
            说明：密码不会回显；留空表示“保持不变”。保存后会刷新页面以重新探测后端。
          </div>

          <Spinner v-if="loading" />

          <template v-else>
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm font-medium text-slate-700">Servers</div>
              <button class="btn" @click="addServer">
                <Icon name="plus" :size="16" class="mr-1" />
                新增
              </button>
            </div>

            <div class="space-y-3">
              <div
                v-for="s in servers"
                :key="s.uid"
                class="border border-slate-200 rounded-xl p-3 sm:p-4"
              >
                <div class="flex items-center justify-between gap-2">
                  <label class="text-sm font-medium text-slate-800 flex items-center gap-2">
                    <input
                      type="radio"
                      name="defaultServer"
                      class="text-blue-500 focus:ring-blue-500/20"
                      :value="s.id"
                      v-model="defaultServerId"
                      :disabled="!s.id.trim()"
                    />
                    默认服务器
                  </label>
                  <button
                    class="icon-btn icon-btn-danger"
                    title="删除"
                    :disabled="!canRemove"
                    @click="removeServer(s.uid)"
                  >
                    <Icon name="trash-2" :size="16" />
                  </button>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div>
                    <div class="text-xs font-medium text-slate-500 mb-1">ID</div>
                    <input v-model="s.id" class="input" placeholder="例如 home-qb" />
                  </div>
                  <div>
                    <div class="text-xs font-medium text-slate-500 mb-1">Name</div>
                    <input v-model="s.name" class="input" placeholder="展示名（可选）" />
                  </div>

                  <div>
                    <div class="text-xs font-medium text-slate-500 mb-1">Type</div>
                    <select v-model="s.type" class="input">
                      <option value="qbit">qBittorrent</option>
                      <option value="trans">Transmission</option>
                    </select>
                  </div>
                  <div>
                    <div class="text-xs font-medium text-slate-500 mb-1">Base URL</div>
                    <input v-model="s.baseUrl" class="input" placeholder="例如 http://qb:8080" />
                  </div>

                  <div>
                    <div class="text-xs font-medium text-slate-500 mb-1">Username</div>
                    <input v-model="s.username" class="input" placeholder="可选（TR 允许为空）" />
                  </div>
                  <div>
                    <div class="text-xs font-medium text-slate-500 mb-1 flex items-center justify-between">
                      <span>Password</span>
                      <button
                        v-if="s.hasPassword"
                        class="text-xs text-slate-500 hover:text-slate-800"
                        type="button"
                        @click="clearPassword(s)"
                      >
                        清除
                      </button>
                    </div>
                    <input
                      v-model="s.password"
                      class="input"
                      type="password"
                      :placeholder="s.hasPassword ? '已保存（留空保持不变）' : '可选'"
                      @input="s.clearPassword = false"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div v-if="errorText" class="text-sm text-red-600 whitespace-pre-wrap">
              {{ errorText }}
            </div>

            <div class="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button class="btn" :disabled="saving" @click="emit('close')">取消</button>
              <button class="btn btn-primary" :disabled="saving" @click="save">
                <Icon v-if="saving" name="loader-2" :size="16" class="mr-1 animate-spin" />
                保存
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
