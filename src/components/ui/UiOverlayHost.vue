<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import Icon from '@/components/Icon.vue'
import { useUiOverlay } from '@/composables/useUiOverlay'

const {
  toasts,
  modal,
  closeModal,
  cancelModal,
  submitModal,
  dismissToast,
  setFormValue,
} = useUiOverlay()

const firstFieldRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const submitButtonRef = ref<HTMLButtonElement | null>(null)
const overlayRootRef = ref<HTMLElement | null>(null)
const dialogRef = ref<HTMLElement | null>(null)

type PageElementState = {
  element: HTMLElement
  ariaHidden: string | null
  inert: boolean
}

const pageElementStates: PageElementState[] = []
let lastFocusedElement: HTMLElement | null = null

const toastToneClass = {
  default: 'border-slate-200 bg-white text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
} as const

const toastIconName = {
  default: 'alert-circle',
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'alert-circle',
} as const

const modalToneClass = computed(() => {
  if (!modal.value) return 'btn-primary'
  if (modal.value.tone === 'danger') return 'btn-destructive'
  return 'btn-primary'
})

function setFirstInputElement(el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    firstFieldRef.value = el
    return
  }

  firstFieldRef.value = null
}

function stopModalKeyEvent(event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function isImeComposing(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229
}

function getDialogFocusableElements() {
  const dialog = dialogRef.value
  if (!dialog) return []

  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

function focusModalEntryTarget(value: NonNullable<typeof modal.value>) {
  if (value.kind === 'form' && firstFieldRef.value) {
    firstFieldRef.value.focus()
    return
  }

  if (submitButtonRef.value) {
    submitButtonRef.value.focus()
    return
  }

  const firstFocusable = getDialogFocusableElements()[0]
  if (firstFocusable) {
    firstFocusable.focus()
    return
  }

  dialogRef.value?.focus()
}

function trapDialogFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return

  const dialog = dialogRef.value
  if (!dialog) return

  const focusableElements = getDialogFocusableElements()
  if (focusableElements.length === 0) {
    stopModalKeyEvent(event)
    dialog.focus()
    return
  }

  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  const activeIndex = activeElement ? focusableElements.indexOf(activeElement) : -1
  const firstFocusable = focusableElements[0]!
  const lastFocusable = focusableElements[focusableElements.length - 1]!

  if (activeIndex === -1) {
    stopModalKeyEvent(event)
    ;(event.shiftKey ? lastFocusable : firstFocusable).focus()
    return
  }

  if (event.shiftKey && activeIndex === 0) {
    stopModalKeyEvent(event)
    lastFocusable.focus()
    return
  }

  if (!event.shiftKey && activeIndex === focusableElements.length - 1) {
    stopModalKeyEvent(event)
    firstFocusable.focus()
  }
}

function restorePageInteractivity() {
  for (const state of pageElementStates) {
    state.element.inert = state.inert
    if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden')
    else state.element.setAttribute('aria-hidden', state.ariaHidden)
  }

  pageElementStates.length = 0
}

function setPageInert() {
  const overlayRoot = overlayRootRef.value
  if (!overlayRoot) return

  restorePageInteractivity()

  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || child === overlayRoot) continue

    pageElementStates.push({
      element: child,
      ariaHidden: child.getAttribute('aria-hidden'),
      inert: child.inert,
    })

    child.inert = true
    child.setAttribute('aria-hidden', 'true')
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (!modal.value) return
  if (event.key === 'Tab') {
    trapDialogFocus(event)
    return
  }
  if (isImeComposing(event)) return
  if (event.key === 'Escape') {
    stopModalKeyEvent(event)
    closeModal()
  }
}

function handleTextareaSubmitKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  if (!event.metaKey && !event.ctrlKey) return
  if (isImeComposing(event)) return

  stopModalKeyEvent(event)
  submitModal()
}

function handleSingleLineSubmitKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  if (isImeComposing(event)) return
  if (!modal.value || modal.value.kind !== 'form') return
  if (modal.value.fields.length !== 1) return

  stopModalKeyEvent(event)
  submitModal()
}

watch(
  () => modal.value,
  async (value, previousValue) => {
    if (value) {
      if (!previousValue) {
        lastFocusedElement = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      }

      document.addEventListener('keydown', handleKeydown)
      setPageInert()
      await nextTick()
      focusModalEntryTarget(value)
      return
    }

    document.removeEventListener('keydown', handleKeydown)
    restorePageInteractivity()
    if (lastFocusedElement?.isConnected) lastFocusedElement.focus()
    lastFocusedElement = null
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  restorePageInteractivity()
})
</script>

<template>
  <Teleport to="body">
    <div ref="overlayRootRef">
      <div
        aria-live="polite"
        aria-atomic="true"
        class="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[120] flex justify-center px-4 sm:justify-end"
      >
        <TransitionGroup
          tag="div"
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="translate-y-2 opacity-0"
          enter-to-class="translate-y-0 opacity-100"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="translate-y-0 opacity-100"
          leave-to-class="translate-y-1 opacity-0"
          class="flex w-full max-w-sm flex-col gap-2"
        >
          <div
            v-for="toast in toasts"
            :key="toast.id"
            class="pointer-events-auto rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-sm"
            :class="toastToneClass[toast.tone]"
          >
            <div class="flex items-start gap-3">
              <div class="mt-0.5">
                <Icon :name="toastIconName[toast.tone]" :size="16" />
              </div>
              <div class="min-w-0 flex-1">
                <p v-if="toast.title" class="text-sm font-semibold">{{ toast.title }}</p>
                <p class="text-sm leading-6">{{ toast.message }}</p>
              </div>
              <button
                type="button"
                class="icon-btn h-8 w-8 shrink-0 border-transparent bg-transparent"
                aria-label="关闭通知"
                @click="dismissToast(toast.id)"
              >
                <Icon name="x" :size="14" />
              </button>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="modal"
          class="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[1px]"
          @click.self="closeModal"
        >
          <div
            ref="dialogRef"
            role="dialog"
            tabindex="-1"
            aria-modal="true"
            :aria-labelledby="modal.kind === 'confirm' ? 'ui-confirm-title' : 'ui-form-title'"
            class="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
          >
            <div class="border-b border-slate-200 px-6 py-4">
              <h2
                :id="modal.kind === 'confirm' ? 'ui-confirm-title' : 'ui-form-title'"
                class="text-lg font-semibold text-slate-950"
              >
                {{ modal.title }}
              </h2>
              <p v-if="modal.kind === 'form' && modal.message" class="mt-2 text-sm leading-6 text-slate-600">
                {{ modal.message }}
              </p>
            </div>

            <div v-if="modal.kind === 'form'" class="space-y-4 px-6 py-5">
              <div
                v-for="(field, index) in modal.fields"
                :key="field.key"
                class="space-y-2"
              >
                <label
                  v-if="field.type !== 'checkbox'"
                  :for="`ui-form-${field.key}`"
                  class="block text-sm font-medium text-slate-700"
                >
                  {{ field.label }}
                </label>

                <label
                  v-if="field.type === 'checkbox'"
                  :for="`ui-form-${field.key}`"
                  class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700"
                >
                  <input
                    :id="`ui-form-${field.key}`"
                    :ref="index === 0 ? setFirstInputElement : undefined"
                    :name="field.name ?? field.key"
                    type="checkbox"
                    class="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900/10"
                    :checked="modal.values[field.key] === 'true'"
                    @change="setFormValue(field.key, ($event.target as HTMLInputElement).checked ? 'true' : '')"
                  />
                  <span class="leading-6">{{ field.label }}</span>
                </label>

                <textarea
                  v-else-if="field.multiline"
                  :id="`ui-form-${field.key}`"
                  :ref="index === 0 ? setFirstInputElement : undefined"
                  :name="field.name ?? field.key"
                  :placeholder="field.placeholder"
                  :autocomplete="field.autocomplete"
                  :required="field.required"
                  :spellcheck="field.spellcheck ?? false"
                  class="input min-h-28 resize-y"
                  :value="modal.values[field.key] ?? ''"
                  @input="setFormValue(field.key, ($event.target as HTMLTextAreaElement).value)"
                  @keydown="handleTextareaSubmitKeydown"
                />

                <input
                  v-else
                  :id="`ui-form-${field.key}`"
                  :ref="index === 0 ? setFirstInputElement : undefined"
                  :name="field.name ?? field.key"
                  :type="field.type ?? 'text'"
                  :placeholder="field.placeholder"
                  :autocomplete="field.autocomplete"
                  :inputmode="field.inputmode"
                  :required="field.required"
                  :spellcheck="field.spellcheck ?? false"
                  class="input"
                  :value="modal.values[field.key] ?? ''"
                  @input="setFormValue(field.key, ($event.target as HTMLInputElement).value)"
                  @keydown="handleSingleLineSubmitKeydown"
                />
              </div>

              <p v-if="modal.errorText" class="text-sm text-rose-600" aria-live="polite">
                {{ modal.errorText }}
              </p>
            </div>

            <div v-else-if="modal.message" class="px-6 py-5">
              <p class="text-sm leading-6 text-slate-700">{{ modal.message }}</p>
            </div>

            <div class="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                type="button"
                class="btn"
                @click="cancelModal"
              >
                {{ modal.cancelLabel }}
              </button>
              <button
                ref="submitButtonRef"
                type="button"
                class="btn"
                :class="modalToneClass"
                @click="submitModal"
              >
                {{ modal.kind === 'confirm' ? modal.confirmLabel : modal.submitLabel }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>
