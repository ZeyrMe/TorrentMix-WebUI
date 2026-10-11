<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { buildFolderTree } from '@/utils/folderTree'
import Icon from '@/components/Icon.vue'
import FolderTreeNode from '@/components/FolderTreeNode.vue'

interface Props {
  paths: string[]
  modelValue: string
  allLabel?: string
  rootLabel?: string
}

interface Emits {
  (e: 'update:modelValue', value: string): void
}

const props = withDefaults(defineProps<Props>(), {
  allLabel: '全部',
  rootLabel: '根目录',
})
const emit = defineEmits<Emits>()

const tree = computed(() => buildFolderTree(props.paths))
const expandedPaths = ref<Set<string>>(new Set())

function toggle(path: string) {
  const next = new Set(expandedPaths.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expandedPaths.value = next
}

function select(path: string) {
  emit('update:modelValue', path)
}

watch(() => props.modelValue, (value) => {
  if (!value || value === 'all') return
  const parts = value.split('/').filter(Boolean)
  if (parts.length <= 1) return

  const next = new Set(expandedPaths.value)
  let current = ''
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    current = current ? `${current}/${part}` : part
    next.add(current)
  }
  expandedPaths.value = next
}, { immediate: true })
</script>

<template>
  <div class="space-y-1">
    <button
      type="button"
      @click="select('all')"
      :class="`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all duration-150 ${
        modelValue === 'all' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
      }`"
    >
      <Icon name="folder-open" :size="14" />
      <span class="truncate text-sm">{{ allLabel }}</span>
    </button>

    <button
      v-if="tree.hasRoot"
      type="button"
      @click="select('')"
      :class="`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all duration-150 ${
        modelValue === '' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
      }`"
    >
      <Icon name="folder" :size="14" />
      <span class="truncate text-sm">{{ rootLabel }}</span>
    </button>

    <FolderTreeNode
      v-for="node in tree.nodes"
      :key="node.path"
      :node="node"
      :level="0"
      :expanded-paths="expandedPaths"
      :selected-path="modelValue"
      @toggle="toggle"
      @select="select"
    />
  </div>
</template>
