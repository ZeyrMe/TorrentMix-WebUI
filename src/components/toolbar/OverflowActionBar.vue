<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'

export type OverflowActionVariant = 'default' | 'primary' | 'danger' | 'warning'

export interface OverflowActionItem {
  id: string
  title: string
  icon: string
  color?: string
  variant?: OverflowActionVariant
  group?: string
  groupLabel?: string
  disabled?: boolean
  show?: boolean
  pinned?: boolean
  priority?: number
  badge?: string | number
}

const props = withDefaults(defineProps<{
  items: OverflowActionItem[]
  overflowTitle?: string
  grouped?: boolean
}>(), {
  overflowTitle: '更多',
  grouped: false,
})

const emit = defineEmits<{
  (e: 'action', id: string): void
}>()

const containerRef = ref<HTMLElement | null>(null)
const measureRef = ref<HTMLElement | null>(null)
const overflowMeasureRef = ref<HTMLElement | null>(null)
const overflowPopoverRef = ref<HTMLElement | null>(null)

const isOverflowOpen = ref(false)
const visibleIds = ref<string[]>([])
const overflowIds = ref<string[]>([])

const itemList = computed(() => props.items.filter(i => i.show !== false))
const allGroups = computed(() => {
  if (!props.grouped) {
    return [{ key: '_default', label: '', items: itemList.value }]
  }

  const groups: Array<{ key: string; label: string; items: OverflowActionItem[] }> = []
  const groupIndex = new Map<string, number>()

  for (const item of itemList.value) {
    const key = item.group ?? '_default'
    const label = item.groupLabel ?? ''
    const idx = groupIndex.get(key)
    if (idx === undefined) {
      groupIndex.set(key, groups.length)
      groups.push({ key, label, items: [item] })
    } else {
      groups[idx]!.items.push(item)
    }
  }

  return groups
})

function closeOverflow() {
  isOverflowOpen.value = false
}

function toggleOverflow() {
  isOverflowOpen.value = !isOverflowOpen.value
}

function handleDocumentClick(e: MouseEvent) {
  if (!isOverflowOpen.value) return
  const target = e.target as Node | null
  if (!target) return
  if (overflowPopoverRef.value && !overflowPopoverRef.value.contains(target)) {
    isOverflowOpen.value = false
  }
}

function classForItem(item: OverflowActionItem, inGroup = false) {
  const classes = ['icon-btn', 'shrink-0', 'relative']
  if (inGroup) classes.push('icon-btn-in-group')
  if (item.variant === 'primary') classes.push('icon-btn-primary')
  if (item.variant === 'danger') classes.push('icon-btn-danger')
  if (item.variant === 'warning') classes.push('text-amber-600', 'hover:bg-amber-50', 'hover:border-amber-200')
  return classes.join(' ')
}

function measureWidths() {
  const measureEl = measureRef.value
  if (!measureEl) return { widths: new Map<string, number>(), overflowButtonWidth: 0 }

  const widths = new Map<string, number>()
  for (const el of Array.from(measureEl.querySelectorAll<HTMLElement>('[data-id]'))) {
    const id = el.dataset.id
    if (!id) continue
    widths.set(id, Math.ceil(el.getBoundingClientRect().width))
  }

  const overflowButtonWidth = overflowMeasureRef.value
    ? Math.ceil(overflowMeasureRef.value.getBoundingClientRect().width)
    : 0

  return { widths, overflowButtonWidth }
}

// Cache measurements so we don't force sync layout reads on every resize tick.
// `icon-btn` has a fixed width today, but caching keeps this component robust
// if styles change (or if we ever add variable-width actions).
let cachedWidths = new Map<string, number>()
let cachedOverflowButtonWidth = 0
function refreshMeasurements() {
  const { widths, overflowButtonWidth } = measureWidths()
  cachedWidths = widths
  cachedOverflowButtonWidth = overflowButtonWidth
}

function computeLayout() {
  const container = containerRef.value
  if (!container) return

  // Prefer ResizeObserver's contentRect width (avoid extra layout reads during resize).
  const available = pendingAvailableWidth ?? Math.floor(container.getBoundingClientRect().width)
  pendingAvailableWidth = null

  const widths = cachedWidths
  const overflowButtonWidth = cachedOverflowButtonWidth
  const items = itemList.value

  if (available <= 0 || items.length === 0) {
    visibleIds.value = items.map(i => i.id)
    overflowIds.value = []
    return
  }

  const DEFAULT_BTN_WIDTH = 36 // w-9 at 16px base; used if measurement isn't ready yet
  const indexed = items.map((item, index) => ({
    item,
    index,
    width: widths.get(item.id) ?? DEFAULT_BTN_WIDTH,
    priority: item.priority ?? 100,
    pinned: item.pinned === true,
    group: item.group ?? '_default',
  }))

  const gapPx = 6 // gap-1.5 in Tailwind = 0.375rem ~= 6px
  const groupGapPx = 8 // gap-2 ~= 8px
  const groupOverheadPx = 8 // p-1 left+right ~= 8px
  const groupSepPx = 9 // w-px + mx-1 ~= 9px

  const allWidth = (() => {
    if (!props.grouped) {
      const total = indexed.reduce((sum, it) => sum + it.width, 0)
      return total + Math.max(0, indexed.length - 1) * gapPx
    }

    const groupsInOrder: string[] = []
    const counts = new Map<string, number>()
    const groupWidths = new Map<string, number>()
    for (const it of indexed) {
      const g = it.group
      if (!counts.has(g)) groupsInOrder.push(g)
      counts.set(g, (counts.get(g) ?? 0) + 1)
      groupWidths.set(g, (groupWidths.get(g) ?? 0) + it.width)
    }

    let total = 0
    let groupCount = 0
    for (const g of groupsInOrder) {
      const count = counts.get(g) ?? 0
      if (count <= 0) continue
      if (groupCount > 0) total += groupGapPx
      total += groupOverheadPx
      total += groupWidths.get(g) ?? 0
      total += Math.max(0, count - 1) * groupSepPx
      groupCount += 1
    }
    return total
  })()

  if (allWidth <= available) {
    visibleIds.value = indexed.map(x => x.item.id)
    overflowIds.value = []
    return
  }

  const reservedWidth = (overflowButtonWidth > 0 ? overflowButtonWidth : DEFAULT_BTN_WIDTH) + gapPx
  const reserved = Math.max(0, reservedWidth)
  const budget = Math.max(0, available - reserved)

  const pinned = indexed.filter(x => x.pinned).sort((a, b) => a.index - b.index)
  const candidates = indexed
    .filter(x => !x.pinned)
    .sort((a, b) => (a.priority - b.priority) || (a.index - b.index))

  const chosen = new Set<string>()
  let used = 0
  const groupCounts = new Map<string, number>()
  let chosenGroupCount = 0

  const tryAdd = (it: (typeof indexed)[number]) => {
    const w = it.width
    const group = it.group
    if (!props.grouped) {
      const extraGap = chosen.size > 0 ? gapPx : 0
      if (used + extraGap + w <= budget) {
        used += extraGap + w
        chosen.add(it.item.id)
        return true
      }
      return false
    }

    const currentCount = groupCounts.get(group) ?? 0
    const extra =
      currentCount === 0
        ? (chosenGroupCount > 0 ? groupGapPx : 0) + groupOverheadPx
        : groupSepPx

    if (used + extra + w <= budget) {
      used += extra + w
      chosen.add(it.item.id)
      groupCounts.set(group, currentCount + 1)
      if (currentCount === 0) chosenGroupCount += 1
      return true
    }
    return false
  }

  for (const p of pinned) {
    if (!tryAdd(p)) break
  }
  for (const c of candidates) {
    tryAdd(c)
  }

  // 如果一个都放不下，至少放第一个（避免只剩更多按钮）
  if (chosen.size === 0 && indexed.length > 0) {
    chosen.add(indexed[0]!.item.id)
  }

  const visible: string[] = []
  for (const it of indexed) {
    if (chosen.has(it.item.id)) visible.push(it.item.id)
  }

  const overflow = indexed
    .filter(x => !chosen.has(x.item.id))
    .sort((a, b) => (a.priority - b.priority) || (a.index - b.index))
    .map(x => x.item.id)

  visibleIds.value = visible
  overflowIds.value = overflow
}

let ro: ResizeObserver | null = null
let rafId: number | null = null
let pendingAvailableWidth: number | null = null
function scheduleCompute() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    computeLayout()
  })
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect?.width
    pendingAvailableWidth = typeof w === 'number' ? Math.floor(w) : null
    scheduleCompute()
  })
  if (containerRef.value) ro.observe(containerRef.value)
  nextTick(() => {
    refreshMeasurements()
    scheduleCompute()
  })
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick)
  if (ro && containerRef.value) ro.unobserve(containerRef.value)
  ro = null
  if (rafId !== null) cancelAnimationFrame(rafId)
})

watch(itemList, async () => {
  await nextTick()
  refreshMeasurements()
  scheduleCompute()
}, { deep: true })

const visibleItems = computed(() => {
  const byId = new Map(itemList.value.map(i => [i.id, i] as const))
  return visibleIds.value.map(id => byId.get(id)).filter(Boolean) as OverflowActionItem[]
})

const overflowItems = computed(() => {
  const byId = new Map(itemList.value.map(i => [i.id, i] as const))
  return overflowIds.value.map(id => byId.get(id)).filter(Boolean) as OverflowActionItem[]
})

const visibleGroups = computed(() => {
  if (!props.grouped) {
    return [{ key: '_default', label: '', items: visibleItems.value }]
  }

  const groups: Array<{ key: string; label: string; items: OverflowActionItem[] }> = []
  const groupIndex = new Map<string, number>()

  for (const item of visibleItems.value) {
    const key = item.group ?? '_default'
    const label = item.groupLabel ?? ''
    const idx = groupIndex.get(key)
    if (idx === undefined) {
      groupIndex.set(key, groups.length)
      groups.push({ key, label, items: [item] })
    } else {
      groups[idx]!.items.push(item)
    }
  }

  return groups
})

const overflowGroups = computed(() => {
  if (!props.grouped) {
    return [{ key: '_default', label: '', items: overflowItems.value }]
  }

  const groups: Array<{ key: string; label: string; items: OverflowActionItem[] }> = []
  const groupIndex = new Map<string, number>()

  for (const item of overflowItems.value) {
    const key = item.group ?? '_default'
    const label = item.groupLabel ?? ''
    const idx = groupIndex.get(key)
    if (idx === undefined) {
      groupIndex.set(key, groups.length)
      groups.push({ key, label, items: [item] })
    } else {
      groups[idx]!.items.push(item)
    }
  }

  return groups
})
</script>

<template>
  <div class="flex items-center gap-1.5 min-w-0">
    <!-- Visible bar -->
    <div
      ref="containerRef"
      class="flex-auto flex items-center min-w-0 overflow-hidden"
      :class="grouped ? 'gap-2' : 'gap-1.5'"
    >
      <template v-if="grouped">
        <div
          v-for="group in visibleGroups"
          :key="group.key"
          class="toolbar-group"
        >
          <template v-for="(item, idx) in group.items" :key="item.id">
            <button
              type="button"
              :class="classForItem(item, true)"
              :disabled="item.disabled"
              :title="item.title"
              :aria-label="item.title"
              @click="emit('action', item.id)"
            >
              <Icon :name="item.icon" :size="16" :color="item.color as any" />
              <span
                v-if="item.badge !== undefined && item.badge !== null && String(item.badge) !== ''"
                class="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] leading-none rounded-full min-w-4 h-4 px-1 flex items-center justify-center"
              >
                {{ item.badge }}
              </span>
            </button>
            <span v-if="idx < group.items.length - 1" class="toolbar-group-sep" aria-hidden="true"></span>
          </template>
        </div>
      </template>
      <template v-else>
        <button
          type="button"
          v-for="item in visibleItems"
          :key="item.id"
          :class="classForItem(item, false)"
          :disabled="item.disabled"
          :title="item.title"
          :aria-label="item.title"
          @click="emit('action', item.id)"
        >
          <Icon :name="item.icon" :size="16" :color="item.color as any" />
          <span
            v-if="item.badge !== undefined && item.badge !== null && String(item.badge) !== ''"
            class="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] leading-none rounded-full min-w-4 h-4 px-1 flex items-center justify-center"
          >
            {{ item.badge }}
          </span>
        </button>
      </template>
    </div>

    <!-- Overflow menu -->
    <div v-if="overflowItems.length > 0" ref="overflowPopoverRef" class="relative shrink-0">
      <button type="button" class="icon-btn" :title="overflowTitle" :aria-label="overflowTitle" @click.stop="toggleOverflow">
        <Icon name="more-horizontal" :size="16" />
      </button>
      <div
        v-if="isOverflowOpen"
        class="absolute right-0 top-full mt-2 bg-white border border-gray-200 shadow-lg rounded-xl z-50 min-w-[12rem] overflow-hidden"
      >
        <div class="py-1">
          <template v-for="group in overflowGroups" :key="group.key">
            <div v-if="group.label" class="px-3 pt-2 pb-1 text-[11px] font-medium text-gray-500">
              {{ group.label }}
            </div>
            <button
              type="button"
              v-for="item in group.items"
              :key="item.id"
              class="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="item.disabled"
              @click="emit('action', item.id); closeOverflow()"
            >
              <Icon :name="item.icon" :size="14" :color="item.color as any" />
              <span class="flex-1 text-left">{{ item.title }}</span>
              <span
                v-if="item.badge !== undefined && item.badge !== null && String(item.badge) !== ''"
                class="text-[11px] text-gray-500"
              >
                {{ item.badge }}
              </span>
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- Measure strip (offscreen) -->
    <div ref="measureRef" class="fixed -left-[9999px] -top-[9999px] opacity-0 pointer-events-none flex items-center gap-1.5">
      <template v-if="grouped">
        <div v-for="group in allGroups" :key="group.key" class="toolbar-group gap-2">
          <button
            type="button"
            v-for="item in group.items"
            :key="item.id"
            :class="classForItem(item, true)"
            :data-id="item.id"
          >
            <Icon :name="item.icon" :size="16" :color="item.color as any" />
            <span
              v-if="item.badge !== undefined && item.badge !== null && String(item.badge) !== ''"
              class="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] leading-none rounded-full min-w-4 h-4 px-1 flex items-center justify-center"
            >
              {{ item.badge }}
            </span>
          </button>
        </div>
      </template>
      <template v-else>
        <button
          type="button"
          v-for="item in itemList"
          :key="item.id"
          :class="classForItem(item, false)"
          :data-id="item.id"
        >
          <Icon :name="item.icon" :size="16" :color="item.color as any" />
          <span
            v-if="item.badge !== undefined && item.badge !== null && String(item.badge) !== ''"
            class="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] leading-none rounded-full min-w-4 h-4 px-1 flex items-center justify-center"
          >
            {{ item.badge }}
          </span>
        </button>
      </template>
      <button ref="overflowMeasureRef" type="button" class="icon-btn">
        <Icon name="more-horizontal" :size="16" />
      </button>
    </div>
  </div>
</template>
