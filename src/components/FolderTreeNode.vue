<script setup lang="ts">
import { computed } from 'vue'
import { VIRTUAL_ROOT_EXTERNAL, type FolderTreeNode } from '@/utils/folderTree'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'

interface Props {
  node: FolderTreeNode
  level: number
  expandedPaths: Set<string>
  selectedPath: string
}

interface Emits {
  (e: 'toggle', path: string): void
  (e: 'select', path: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

defineOptions({ name: 'FolderTreeNode' })

const isExpanded = computed(() => props.expandedPaths.has(props.node.path))
const hasChildren = computed(() => props.node.children.length > 0)
const isSelected = computed(() => props.selectedPath === props.node.path)
const isExternalRoot = computed(() => props.node.path === VIRTUAL_ROOT_EXTERNAL)
const displayName = computed(() => (isExternalRoot.value ? '外部目录' : props.node.name))
const displayIcon = computed(() => (isExternalRoot.value ? 'globe' : 'folder'))

function handleToggle() {
  if (!hasChildren.value) return
  emit('toggle', props.node.path)
}

function handleSelect() {
  emit('select', props.node.path)
}
</script>

<template>
  <div class="space-y-1">
    <div
      :class="`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-150 ${
        isSelected ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
      }`"
      :style="{ paddingLeft: `${12 + level * 12}px` }"
    >
      <button
        v-if="hasChildren"
        type="button"
        :class="`p-0.5 rounded ${isSelected ? 'hover:bg-white/20' : 'hover:bg-black/10'}`"
        @click.stop="handleToggle"
        :title="isExpanded ? '折叠' : '展开'"
      >
        <Icon :name="isExpanded ? 'chevron-down' : 'chevron-right'" :size="14" />
      </button>
      <span v-else class="w-4 shrink-0" />

      <button
        type="button"
        class="flex-1 min-w-0 flex items-center gap-2 text-left"
        @click="handleSelect"
      >
        <Icon :name="displayIcon" :size="14" class="shrink-0" />
        <SafeText as="span" class="truncate text-sm" :text="displayName" />
      </button>
    </div>

    <div v-if="hasChildren && isExpanded" class="space-y-1">
      <FolderTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :level="level + 1"
        :expanded-paths="expandedPaths"
        :selected-path="selectedPath"
        @toggle="emit('toggle', $event)"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>
