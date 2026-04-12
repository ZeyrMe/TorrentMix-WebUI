<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'

interface Props {
  modelValue: string
  inline: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const popoverOpen = ref(false)
const popoverRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

async function openPopover() {
  if (props.inline) return

  popoverOpen.value = true
  await nextTick()
  inputRef.value?.focus()
}

function closePopover() {
  popoverOpen.value = false
}

async function togglePopover() {
  if (popoverOpen.value) {
    closePopover()
    return
  }

  await openPopover()
}

function updateValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target as Node | null
  if (!target || !popoverOpen.value) return
  if (popoverRef.value?.contains(target)) return

  closePopover()
}

watch(
  () => props.inline,
  (inline) => {
    if (inline) closePopover()
  }
)

watch(popoverOpen, (open) => {
  if (open) {
    document.addEventListener('click', handleDocumentClick)
    return
  }

  document.removeEventListener('click', handleDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<template>
  <div v-if="inline" class="relative w-[clamp(9rem,14vw,14rem)] min-w-0">
    <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
    <input
      :value="modelValue"
      ref="inputRef"
      type="search"
      name="torrentSearch"
      autocomplete="off"
      inputmode="search"
      aria-label="搜索种子名称"
      placeholder="搜索种子名称..."
      class="input pl-10 py-2"
      @input="updateValue"
    />
  </div>

  <div v-else ref="popoverRef" class="relative">
    <button
      type="button"
      class="icon-btn"
      :aria-label="popoverOpen ? '收起搜索框' : '打开搜索框'"
      :aria-expanded="popoverOpen"
      title="搜索"
      @click.stop="togglePopover"
    >
      <Icon name="search" :size="16" />
    </button>

    <div
      v-if="popoverOpen"
      class="absolute right-0 top-full mt-2 z-50 w-[min(92vw,22rem)] rounded-xl border border-gray-200 bg-white shadow-lg"
    >
      <div class="p-2">
        <div class="flex items-center gap-2">
          <div class="relative flex-1 min-w-0">
            <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref="inputRef"
              :value="modelValue"
              type="search"
              name="torrentSearchPopover"
              autocomplete="off"
              inputmode="search"
              aria-label="搜索种子名称"
              placeholder="搜索种子名称..."
              class="input pl-10 py-2"
              @input="updateValue"
              @keydown.esc.stop.prevent="closePopover"
            />
          </div>

          <button
            type="button"
            class="icon-btn"
            aria-label="关闭搜索框"
            title="关闭搜索"
            @click="closePopover"
          >
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="mt-2 px-1 text-[11px] text-gray-400">
          Esc 关闭，点击空白处收起
        </div>
      </div>
    </div>
  </div>
</template>
