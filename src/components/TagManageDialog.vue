<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useBackendStore } from '@/store/backend'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import Spinner from '@/components/ui/Spinner.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
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

function notifyError(err: unknown, fallback: string) {
  overlay.notify({
    message: err instanceof Error ? err.message : fallback,
    tone: 'danger',
  })
}

// 加载标签列表
async function loadTags() {
  loading.value = true
  try {
    tags.value = await adapter.getTags()
  } catch (err) {
    console.error('[TagManage] Load failed:', err)
    notifyError(err, '加载标签失败')
  } finally {
    loading.value = false
  }
}

// 创建标签
async function handleCreate() {
  if (backendStore.isTrans) {
    overlay.notify({
      message: 'Transmission 不支持预创建标签（labels 会随种子自动出现）。请在种子列表右键“设置标签”。',
      tone: 'warning',
    })
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
    notifyError(err, '创建标签失败')
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
    notifyError(err, '删除标签失败')
  }
}

onMounted(() => {
  loadTags()
})
</script>

<template>
  <BaseDialog title="标签管理" max-width="max-w-lg" @close="emit('close')">
    <!-- 创建表单（qB 专属） -->
    <div v-if="backendStore.isQbit" class="mb-6 p-4 bg-slate-50 rounded-xl">
      <h3 class="text-sm font-medium mb-3">创建标签</h3>
      <div class="flex flex-col sm:flex-row gap-3">
        <input
          v-model="input"
          @keydown.enter="handleCreate"
          type="text"
          placeholder="标签名称 (多个标签用逗号分隔)"
          class="input flex-1"
        />
        <button
          @click="handleCreate"
          :disabled="!input.trim()"
          class="btn btn-primary"
        >
          创建
        </button>
      </div>
    </div>

    <!-- 提示（Transmission labels） -->
    <div v-else-if="backendStore.isTrans" class="mb-6 p-4 bg-amber-50 text-amber-800 rounded-xl text-sm">
      <div class="font-medium mb-1">Transmission 标签说明</div>
      <div>Transmission 不支持“全局预创建标签”，labels 会随种子自动出现；这里的“删除”会从所有种子移除该标签。</div>
    </div>

    <!-- 标签列表 -->
    <Spinner v-if="loading" />
    <EmptyState v-else-if="tags.length === 0">暂无标签</EmptyState>
    <div v-else class="flex flex-wrap gap-2">
      <span
        v-for="tag in tags"
        :key="tag"
        class="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 rounded-full text-sm"
      >
        <Icon name="tag" :size="12" class="text-slate-400" />
        <SafeText as="span" :text="tag" />
        <button
          @click="handleDelete(tag)"
          class="ml-1 p-0.5 hover:bg-slate-200 rounded"
          title="删除"
        >
          <Icon name="x" :size="10" />
        </button>
      </span>
    </div>
  </BaseDialog>
</template>
