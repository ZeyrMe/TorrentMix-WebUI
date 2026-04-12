import { ref } from 'vue'

export type UiTone = 'default' | 'success' | 'warning' | 'danger'

export interface UiToast {
  id: number
  title?: string
  message: string
  tone: UiTone
}

export interface UiConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: UiTone
}

export interface UiFormField {
  key: string
  label: string
  name?: string
  placeholder?: string
  defaultValue?: string
  type?: 'text' | 'password' | 'number' | 'url' | 'checkbox'
  autocomplete?: string
  inputmode?: 'text' | 'numeric' | 'decimal' | 'search' | 'email' | 'tel' | 'url'
  multiline?: boolean
  required?: boolean
  spellcheck?: boolean
}

export interface UiFormOptions {
  title: string
  message?: string
  submitLabel?: string
  cancelLabel?: string
  tone?: UiTone
  fields: UiFormField[]
  validate?: (values: Record<string, string>) => string | null
}

type UiConfirmModalState = {
  kind: 'confirm'
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  tone: UiTone
  resolve: (value: boolean | null) => void
}

type UiFormModalState = {
  kind: 'form'
  title: string
  message?: string
  submitLabel: string
  cancelLabel: string
  tone: UiTone
  fields: UiFormField[]
  values: Record<string, string>
  errorText: string
  validate?: (values: Record<string, string>) => string | null
  resolve: (value: Record<string, string> | null) => void
}

export type UiModalState = UiConfirmModalState | UiFormModalState | null

const toasts = ref<UiToast[]>([])
const modal = ref<UiModalState>(null)

let toastId = 0

function canUseOverlayHost(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function closeModal() {
  const current = modal.value
  if (!current) return

  current.resolve(null)
  modal.value = null
}

function cancelModal() {
  const current = modal.value
  if (!current) return

  if (current.kind === 'confirm') current.resolve(false)
  else current.resolve(null)

  modal.value = null
}

function resetOverlay() {
  closeModal()
  toasts.value = []
}

function dismissToast(id: number) {
  toasts.value = toasts.value.filter(toast => toast.id !== id)
}

function notify(options: {
  title?: string
  message: string
  tone?: UiTone
  timeoutMs?: number
}) {
  if (!canUseOverlayHost()) {
    return
  }

  const id = ++toastId
  const timeoutMs = options.timeoutMs ?? 4000

  toasts.value = [
    ...toasts.value,
    {
      id,
      title: options.title,
      message: options.message,
      tone: options.tone ?? 'default',
    },
  ]

  window.setTimeout(() => dismissToast(id), timeoutMs)
}

function confirm(options: UiConfirmOptions): Promise<boolean | null> {
  if (!canUseOverlayHost()) {
    return Promise.resolve(globalThis.confirm?.(options.message) ?? false)
  }

  if (modal.value) closeModal()

  return new Promise<boolean | null>((resolve) => {
    modal.value = {
      kind: 'confirm',
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? '确认',
      cancelLabel: options.cancelLabel ?? '取消',
      tone: options.tone ?? 'default',
      resolve,
    }
  })
}

function openForm(options: UiFormOptions): Promise<Record<string, string> | null> {
  if (!canUseOverlayHost()) {
    const values: Record<string, string> = {}
    for (const field of options.fields) {
      if (field.type === 'checkbox') {
        const checked = globalThis.confirm?.(field.label) ?? false
        values[field.key] = checked ? 'true' : ''
        continue
      }

      const input = globalThis.prompt?.(field.label, field.defaultValue ?? '')
      if (input === null || input === undefined) return Promise.resolve(null)
      values[field.key] = input
    }

    const validationError = options.validate?.(values) ?? null
    if (validationError) {
      return Promise.resolve(null)
    }

    return Promise.resolve(values)
  }

  if (modal.value) closeModal()

  return new Promise<Record<string, string> | null>((resolve) => {
    modal.value = {
      kind: 'form',
      title: options.title,
      message: options.message,
      submitLabel: options.submitLabel ?? '保存',
      cancelLabel: options.cancelLabel ?? '取消',
      tone: options.tone ?? 'default',
      fields: options.fields,
      values: Object.fromEntries(
        options.fields.map(field => [field.key, field.defaultValue ?? '']),
      ),
      errorText: '',
      validate: options.validate,
      resolve,
    }
  })
}

function setFormValue(key: string, value: string) {
  if (!modal.value || modal.value.kind !== 'form') return
  modal.value.values[key] = value
  modal.value.errorText = ''
}

function submitModal() {
  const current = modal.value
  if (!current) return

  if (current.kind === 'confirm') {
    current.resolve(true)
    modal.value = null
    return
  }

  const validationError = current.validate?.(current.values) ?? null
  if (validationError) {
    current.errorText = validationError
    return
  }

  current.resolve({ ...current.values })
  modal.value = null
}

export function useUiOverlay() {
  return {
    toasts,
    modal,
    notify,
    confirm,
    openForm,
    closeModal,
    cancelModal,
    resetOverlay,
    submitModal,
    dismissToast,
    setFormValue,
  }
}
