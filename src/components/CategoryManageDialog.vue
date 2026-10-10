<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useBackendStore } from '@/store/backend'
import type { Category } from '@/adapter/types'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'
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

// 加载分类列表
async function loadCategories() {
  loading.value = true
  try {
    categories.value = await adapter.value.getCategories()
  } catch (err) {
    console.error('[CategoryManage] Load failed:', err)
    alert(err instanceof Error ? err.message : '加载分类失败')
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
    alert(err instanceof Error ? err.message : '创建分类失败')
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
    alert(err instanceof Error ? err.message : '编辑分类失败')
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
    alert(err instanceof Error ? err.message : '删除分类失败')
  }
}

// 设置保存路径
async function handleSetSavePath(name: string) {
  const path = prompt('输入保存路径:')
  if (!path) return

  try {
    await adapter.value.setCategorySavePath(name, path)
    await loadCategories()
  } catch (err) {
    console.error('[CategoryManage] Set save path failed:', err)
    alert(err instanceof Error ? err.message : '设置保存路径失败')
  }
}

onMounted(() => {
  loadCategories()
})
</script>

<template>
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    @click.self="emit('close')"
  >
    <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
      <!-- 标题栏 -->
      <div class="px-4 py-3 sm:px-6 sm:py-4 border-b flex items-center justify-between">
        <h2 class="text-lg font-semibold">分类管理</h2>
        <button @click="emit('close')" class="p-1 hover:bg-gray-100 rounded">
          <Icon name="x" :size="16" />
        </button>
      </div>

      <!-- 内容区 -->
      <div class="flex-1 overflow-auto p-4 sm:p-6">
        <!-- 创建/编辑表单 -->
        <div class="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 class="text-sm font-medium mb-3">
            {{ editing ? '编辑分类' : '创建分类' }}
          </h3>
          <div class="flex flex-col sm:flex-row gap-3">
            <input
              v-model="form.name"
              type="text"
              placeholder="分类名称"
              class="flex-1 px-3 py-2 border rounded text-sm"
            />
            <input
              v-model="form.savePath"
              type="text"
              placeholder="保存路径 (可选)"
              class="flex-1 px-3 py-2 border rounded text-sm"
            />
            <button
              v-if="!editing"
              @click="handleCreate"
              :disabled="!form.name.trim()"
              class="px-4 py-2 bg-black text-white rounded text-sm disabled:opacity-50"
            >
              创建
            </button>
            <template v-else>
              <button
                @click="handleEdit"
                class="px-4 py-2 bg-black text-white rounded text-sm"
              >
                保存
              </button>
              <button
                @click="cancelEdit"
                class="px-4 py-2 border rounded text-sm"
              >
                取消
              </button>
            </template>
          </div>
        </div>

        <!-- 分类列表 -->
        <div v-if="loading" class="text-center text-gray-500 py-8">
          加载中...
        </div>
        <div v-else-if="categories.size === 0" class="text-center text-gray-500 py-8">
          暂无分类
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="[name, cat] in categories"
            :key="name"
            class="flex items-center gap-3 p-3 border rounded hover:bg-gray-50"
          >
            <Icon name="folder" :size="16" class="text-gray-400" />
            <SafeText as="span" class="flex-1 font-medium" :text="name" />
            <span class="text-sm text-gray-500 truncate max-w-[40vw] sm:max-w-[200px]">
              {{ cat.savePath || '默认路径' }}
            </span>
            <button
              @click="startEdit(name)"
              class="p-1 hover:bg-gray-200 rounded"
              title="编辑"
            >
              <Icon name="edit-2" :size="14" />
            </button>
            <button
              @click="handleSetSavePath(name)"
              class="p-1 hover:bg-gray-200 rounded"
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
      </div>
    </div>
  </div>
</template>
