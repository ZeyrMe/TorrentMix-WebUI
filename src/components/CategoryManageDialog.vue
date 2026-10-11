<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useBackendStore } from '@/store/backend'
import type { Category } from '@/adapter/types'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import Spinner from '@/components/ui/Spinner.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useUiOverlay } from '@/composables/useUiOverlay'

const backendStore = useBackendStore()
const adapter = computed(() => backendStore.adapter!)
const overlay = useUiOverlay()

const emit = defineEmits<{
  close: []
}>()

const categories = ref<Map<string, Category>>(new Map())
const loading = ref(false)
const editing = ref<string | null>(null)

// 表单
const form = ref({
  name: '',
  savePath: ''
})

function notifyError(err: unknown, fallback: string) {
  overlay.notify({
    message: err instanceof Error ? err.message : fallback,
    tone: 'danger',
  })
}

// 加载分类列表
async function loadCategories() {
  loading.value = true
  try {
    categories.value = await adapter.value.getCategories()
  } catch (err) {
    console.error('[CategoryManage] Load failed:', err)
    notifyError(err, '加载分类失败')
  } finally {
    loading.value = false
  }
}

// 创建分类
async function handleCreate() {
  if (!form.value.name.trim()) return

  try {
    await adapter.value.createCategory(form.value.name, form.value.savePath || undefined)
    form.value = { name: '', savePath: '' }
    await loadCategories()
  } catch (err) {
    console.error('[CategoryManage] Create failed:', err)
    notifyError(err, '创建分类失败')
  }
}

// 编辑分类
function startEdit(name: string) {
  const cat = categories.value.get(name)
  editing.value = name
  form.value = {
    name,
    savePath: cat?.savePath || ''
  }
}

async function handleEdit() {
  if (!editing.value) return

  const oldName = editing.value
  const cat = categories.value.get(oldName)

  try {
    await adapter.value.editCategory(
      oldName,
      form.value.name !== oldName ? form.value.name : undefined,
      form.value.savePath !== cat?.savePath ? form.value.savePath : undefined
    )
    editing.value = null
    form.value = { name: '', savePath: '' }
    await loadCategories()
  } catch (err) {
    console.error('[CategoryManage] Edit failed:', err)
    notifyError(err, '编辑分类失败')
  }
}

// 取消编辑
function cancelEdit() {
  editing.value = null
  form.value = { name: '', savePath: '' }
}

// 删除分类
async function handleDelete(name: string) {
  const confirmed = await overlay.confirm({
    title: '删除分类',
    message: `确定要删除分类 "${name}" 吗？`,
    confirmLabel: '删除',
    cancelLabel: '取消',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    await adapter.value.deleteCategories(name)
    await loadCategories()
  } catch (err) {
    console.error('[CategoryManage] Delete failed:', err)
    notifyError(err, '删除分类失败')
  }
}

// 设置保存路径
async function handleSetSavePath(name: string) {
  const values = await overlay.openForm({
    title: '设置保存路径',
    fields: [
      { key: 'path', label: '保存路径', placeholder: '例如 /downloads/movies', required: true },
    ],
  })
  if (!values) return
  const path = values.path?.trim()
  if (!path) return

  try {
    await adapter.value.setCategorySavePath(name, path)
    await loadCategories()
  } catch (err) {
    console.error('[CategoryManage] Set save path failed:', err)
    notifyError(err, '设置保存路径失败')
  }
}

onMounted(() => {
  loadCategories()
})
</script>

<template>
  <BaseDialog title="分类管理" max-width="max-w-2xl" @close="emit('close')">
    <!-- 创建/编辑表单 -->
    <div class="mb-6 p-4 bg-slate-50 rounded-xl">
      <h3 class="text-sm font-medium mb-3">
        {{ editing ? '编辑分类' : '创建分类' }}
      </h3>
      <div class="flex flex-col sm:flex-row gap-3">
        <input
          v-model="form.name"
          type="text"
          placeholder="分类名称"
          class="input flex-1"
        />
        <input
          v-model="form.savePath"
          type="text"
          placeholder="保存路径 (可选)"
          class="input flex-1"
        />
        <button
          v-if="!editing"
          @click="handleCreate"
          :disabled="!form.name.trim()"
          class="btn btn-primary"
        >
          创建
        </button>
        <template v-else>
          <button
            @click="handleEdit"
            class="btn btn-primary"
          >
            保存
          </button>
          <button
            @click="cancelEdit"
            class="btn"
          >
            取消
          </button>
        </template>
      </div>
    </div>

    <!-- 分类列表 -->
    <Spinner v-if="loading" />
    <EmptyState v-else-if="categories.size === 0">暂无分类</EmptyState>
    <div v-else class="space-y-2">
      <div
        v-for="[name, cat] in categories"
        :key="name"
        class="flex items-center gap-3 p-3 border rounded-xl hover:bg-slate-50"
      >
        <Icon name="folder" :size="16" class="text-slate-400" />
        <SafeText as="span" class="flex-1 font-medium" :text="name" />
        <span class="text-sm text-slate-500 truncate max-w-[40vw] sm:max-w-[200px]">
          {{ cat.savePath || '默认路径' }}
        </span>
        <button
          @click="startEdit(name)"
          class="p-1 hover:bg-slate-200 rounded"
          title="编辑"
        >
          <Icon name="edit-2" :size="14" />
        </button>
        <button
          @click="handleSetSavePath(name)"
          class="p-1 hover:bg-slate-200 rounded"
          title="设置路径"
        >
          <Icon name="folder-open" :size="14" />
        </button>
        <button
          @click="handleDelete(name)"
          class="p-1 hover:bg-red-50 text-red-600 rounded"
          title="删除"
        >
          <Icon name="trash-2" :size="14" />
        </button>
      </div>
    </div>
  </BaseDialog>
</template>
