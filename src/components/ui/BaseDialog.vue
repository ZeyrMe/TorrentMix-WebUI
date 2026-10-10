<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { useModalKeyboard } from '@/composables/useModalKeyboard'

/**
 * 统一对话框外壳：遮罩、面板、标题栏、关闭按钮。
 * 内建 ESC 关闭、Tab focus-trap、点击遮罩关闭，关闭后归还焦点。
 */
const props = withDefaults(defineProps<{
  title: string
  /** 面板宽度的 Tailwind max-w-* 类 */
  maxWidth?: string
  /** 内容区自定义类（默认 p-4 sm:p-6，传空字符串可完全自控） */
  contentClass?: string
}>(), {
  maxWidth: 'max-w-lg',
  contentClass: 'p-4 sm:p-6',
})

const emit = defineEmits<{ close: [] }>()

const panelRef = ref<HTMLElement | null>(null)
useModalKeyboard(panelRef, () => emit('close'))
</script>

<template>
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    @click.self="emit('close')"
  >
    <div
      ref="panelRef"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      :aria-label="props.title"
      class="bg-white rounded-xl shadow-xl w-full max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col outline-none"
      :class="props.maxWidth"
    >
      <!-- 标题栏 -->
      <div class="px-4 py-3 sm:px-6 sm:py-4 border-b flex items-center justify-between gap-2">
        <slot name="title">
          <h2 class="text-lg font-semibold truncate">{{ props.title }}</h2>
        </slot>
        <div class="flex items-center gap-2 shrink-0">
          <slot name="header-actions" />
          <button @click="emit('close')" class="p-1 hover:bg-slate-100 rounded-lg" title="关闭">
            <Icon name="x" :size="16" />
          </button>
        </div>
      </div>

      <!-- 内容区 -->
      <div class="flex-1 overflow-auto" :class="props.contentClass">
        <slot />
      </div>

      <!-- 底部（可选） -->
      <div v-if="$slots.footer" class="px-4 py-3 sm:px-6 border-t">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>
