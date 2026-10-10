<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useBackendStore } from '@/store/backend'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'
import { useUiOverlay } from '@/composables/useUiOverlay'

const backendStore = useBackendStore()
const adapter = backendStore.adapter!
const overlay = useUiOverlay()

const emit = defineEmits<{
  close: []
}>()

const tags = ref<string[]>([])
const loading = ref(false)

// 输入框
const input = ref('')

// 加载标签列表
async function loadTags() {
  loading.value = true
  try {
    tags.value = await adapter.getTags()
  } catch (err) {
    console.error('[TagManage] Load failed:', err)
    alert(err instanceof Error ? err.message : '加载标签失败')
  } finally {
    loading.value = false
  }
}

// 创建标签
async function handleCreate() {
  if (backendStore.isTrans) {
    alert('Transmission 不支持预创建标签（labels 会随种子自动出现）。请在种子列表右键“设置标签”。')
    return
  }
  if (!input.value.trim()) return

  const newTags = input.value.split(',').map(t => t.trim()).filter(Boolean)

  try {
    await adapter.createTags(...newTags)
    input.value = ''
    await loadTags()
  } catch (err) {
    console.error('[TagManage] Create failed:', err)
    alert(err instanceof Error ? err.message : '创建标签失败')
  }
}

// 删除标签
async function handleDelete(tag: string) {
  const message = backendStore.isTrans
    ? `确定要从所有种子移除标签 "${tag}" 吗？`
    : `确定要删除标签 "${tag}" 吗？`
  const confirmed = await overlay.confirm({
    title: '删除标签',
    message,
    confirmLabel: '删除',
    cancelLabel: '取消',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    await adapter.deleteTags(tag)
    await loadTags()
  } catch (err) {
    console.error('[TagManage] Delete failed:', err)
    alert(err instanceof Error ? err.message : '删除标签失败')
  }
}

onMounted(() => {
  loadTags()
})
</script>

<template>
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    @click.self="emit('close')"
  >
    <div class="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
      <!-- 标题栏 -->
      <div class="px-4 py-3 sm:px-6 sm:py-4 border-b flex items-center justify-between">
        <h2 class="text-lg font-semibold">标签管理</h2>
        <button @click="emit('close')" class="p-1 hover:bg-gray-100 rounded">
          <Icon name="x" :size="16" />
        </button>
      </div>

      <!-- 内容区 -->
      <div class="flex-1 overflow-auto p-4 sm:p-6">
        <!-- 创建表单（qB 专属） -->
        <div v-if="backendStore.isQbit" class="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 class="text-sm font-medium mb-3">创建标签</h3>
          <div class="flex flex-col sm:flex-row gap-3">
            <input
              v-model="input"
              @keydown.enter="handleCreate"
              type="text"
              placeholder="标签名称 (多个标签用逗号分隔)"
              class="flex-1 px-3 py-2 border rounded text-sm"
            />
            <button
              @click="handleCreate"
              :disabled="!input.trim()"
              class="px-4 py-2 bg-black text-white rounded text-sm disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </div>

        <!-- 提示（Transmission labels） -->
        <div v-else-if="backendStore.isTrans" class="mb-6 p-4 bg-amber-50 text-amber-800 rounded-lg text-sm">
          <div class="font-medium mb-1">Transmission 标签说明</div>
          <div>Transmission 不支持“全局预创建标签”，labels 会随种子自动出现；这里的“删除”会从所有种子移除该标签。</div>
        </div>

        <!-- 标签列表 -->
        <div v-if="loading" class="text-center text-gray-500 py-8">
          加载中...
        </div>
        <div v-else-if="tags.length === 0" class="text-center text-gray-500 py-8">
          暂无标签
        </div>
        <div v-else class="flex flex-wrap gap-2">
          <span
            v-for="tag in tags"
            :key="tag"
            class="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
          >
            <Icon name="tag" :size="12" class="text-gray-400" />
            <SafeText as="span" :text="tag" />
            <button
              @click="handleDelete(tag)"
              class="ml-1 p-0.5 hover:bg-gray-200 rounded"
              title="删除"
            >
              <Icon name="x" :size="10" />
            </button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
