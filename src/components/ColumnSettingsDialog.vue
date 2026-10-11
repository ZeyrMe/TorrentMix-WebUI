<script setup lang="ts">
import type { ColumnState } from '@/composables/useTableColumns/types'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { useUiOverlay } from '@/composables/useUiOverlay'

interface Props {
  open: boolean
  columns: ColumnState[]
}

interface Emits {
  (e: 'close'): void
  (e: 'toggleVisibility', columnId: string): void
  (e: 'reset'): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()
const overlay = useUiOverlay()

async function handleReset() {
  const confirmed = await overlay.confirm({
    title: '重置列设置',
    message: '确定要重置所有列宽和可见性为默认设置吗?',
    confirmLabel: '重置',
    cancelLabel: '取消',
    tone: 'warning',
  })
  if (confirmed) {
    emit('reset')
  }
}
</script>

<template>
  <Teleport to="body">
    <BaseDialog v-if="open" title="列设置" max-width="max-w-lg" @close="emit('close')">
      <div class="text-xs font-medium text-slate-500 mb-2">显示列</div>
      <label
        v-for="column in columns"
        :key="column.id"
        class="flex items-center gap-2 px-2 py-2 hover:bg-slate-50 cursor-pointer rounded text-sm transition-colors duration-150"
        :class="{ 'opacity-50 cursor-not-allowed': column.visible && columns.filter(c => c.visible).length <= 1 }"
      >
        <input
          type="checkbox"
          :checked="column.visible"
          :disabled="column.visible && columns.filter(c => c.visible).length <= 1"
          @change="emit('toggleVisibility', column.id)"
          class="rounded border-slate-300 text-blue-500 focus:ring-blue-500/20"
        />
        <span class="flex-1">{{ column.label || '(空列)' }}</span>
      </label>

      <div class="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between">
        <button class="btn" @click="handleReset">重置为默认</button>
        <button class="btn btn-primary" @click="emit('close')">完成</button>
      </div>
    </BaseDialog>
  </Teleport>
</template>
