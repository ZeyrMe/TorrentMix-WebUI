import assert from 'node:assert/strict'
import test from 'node:test'
import { useUiOverlay } from '@/composables/useUiOverlay'

test('ui overlay: dismissing confirm resolves null while cancel button resolves false', async (t) => {
  const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window
  const originalDocument = (globalThis as typeof globalThis & { document?: unknown }).document

  ;(globalThis as typeof globalThis & { window?: unknown }).window = {}
  ;(globalThis as typeof globalThis & { document?: unknown }).document = {}

  const overlay = useUiOverlay()

  t.after(() => {
    overlay.closeModal()

    if (originalWindow === undefined) {
      delete (globalThis as typeof globalThis & { window?: unknown }).window
    } else {
      ;(globalThis as typeof globalThis & { window?: unknown }).window = originalWindow
    }

    if (originalDocument === undefined) {
      delete (globalThis as typeof globalThis & { document?: unknown }).document
    } else {
      ;(globalThis as typeof globalThis & { document?: unknown }).document = originalDocument
    }
  })

  const dismissPromise = overlay.confirm({
    title: '删除种子',
    message: '是否同时删除下载文件？',
    confirmLabel: '删除种子与文件',
    cancelLabel: '仅删除种子',
    tone: 'danger',
  })

  overlay.closeModal()
  assert.equal(await dismissPromise, null)

  const cancelPromise = overlay.confirm({
    title: '删除种子',
    message: '是否同时删除下载文件？',
    confirmLabel: '删除种子与文件',
    cancelLabel: '仅删除种子',
    tone: 'danger',
  })

  overlay.cancelModal()
  assert.equal(await cancelPromise, false)
})

test('ui overlay: setFormValue should keep current modal instance stable', async (t) => {
  const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window
  const originalDocument = (globalThis as typeof globalThis & { document?: unknown }).document

  ;(globalThis as typeof globalThis & { window?: unknown }).window = {}
  ;(globalThis as typeof globalThis & { document?: unknown }).document = {}

  const overlay = useUiOverlay()

  t.after(() => {
    overlay.closeModal()

    if (originalWindow === undefined) {
      delete (globalThis as typeof globalThis & { window?: unknown }).window
    } else {
      ;(globalThis as typeof globalThis & { window?: unknown }).window = originalWindow
    }

    if (originalDocument === undefined) {
      delete (globalThis as typeof globalThis & { document?: unknown }).document
    } else {
      ;(globalThis as typeof globalThis & { document?: unknown }).document = originalDocument
    }
  })

  const submitPromise = overlay.openForm({
    title: '批量限速',
    fields: [
      { key: 'downloadLimit', label: '下载限制' },
      { key: 'uploadLimit', label: '上传限制' },
    ],
    validate: () => '请输入合法的值',
  })

  const currentModal = overlay.modal.value
  assert.ok(currentModal && currentModal.kind === 'form')

  overlay.setFormValue('uploadLimit', '512')

  assert.equal(overlay.modal.value, currentModal)
  assert.equal(currentModal.values.uploadLimit, '512')

  overlay.submitModal()

  assert.equal(overlay.modal.value, currentModal)
  assert.equal(currentModal.errorText, '请输入合法的值')

  overlay.closeModal()
  assert.equal(await submitPromise, null)
})

test('ui overlay: resetOverlay should clear modal and toasts', async (t) => {
  const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window
  const originalDocument = (globalThis as typeof globalThis & { document?: unknown }).document

  ;(globalThis as typeof globalThis & { window?: unknown }).window = {
    setTimeout,
  }
  ;(globalThis as typeof globalThis & { document?: unknown }).document = {}

  const overlay = useUiOverlay()

  t.after(() => {
    overlay.resetOverlay()

    if (originalWindow === undefined) {
      delete (globalThis as typeof globalThis & { window?: unknown }).window
    } else {
      ;(globalThis as typeof globalThis & { window?: unknown }).window = originalWindow
    }

    if (originalDocument === undefined) {
      delete (globalThis as typeof globalThis & { document?: unknown }).document
    } else {
      ;(globalThis as typeof globalThis & { document?: unknown }).document = originalDocument
    }
  })

  const confirmPromise = overlay.confirm({
    title: '确认删除',
    message: '确定继续吗？',
  })

  overlay.notify({
    title: '提示',
    message: '一条通知',
  })

  assert.ok(overlay.modal.value)
  assert.equal(overlay.toasts.value.length, 1)

  overlay.resetOverlay()

  assert.equal(overlay.modal.value, null)
  assert.equal(overlay.toasts.value.length, 0)
  assert.equal(await confirmPromise, null)
})
