import { onMounted, onUnmounted, watch, type Ref } from 'vue'

/**
 * 模态对话框键盘行为：ESC 关闭 + Tab focus-trap + 关闭后归还焦点。
 * BaseDialog 内置使用；带自定义外壳（如含 Transition）的对话框可直接接入以保持交互一致。
 *
 * @param enabled 常驻挂载、用 open prop 控制显隐的组件传入此开关；
 *                随 v-if 挂载/卸载的组件（如 BaseDialog）省略即可。
 */
export function useModalKeyboard(
  panelRef: Ref<HTMLElement | null>,
  onClose: () => void,
  enabled?: Ref<boolean>,
) {
  let previousActive: HTMLElement | null = null
  let active = false

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }

    if (e.key !== 'Tab') return
    const panel = panelRef.value
    if (!panel) return

    const focusables = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (!focusables.length) return

    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    const current = document.activeElement

    if (e.shiftKey && (current === first || !panel.contains(current))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (current === last || !panel.contains(current))) {
      e.preventDefault()
      first.focus()
    }
  }

  function activate() {
    if (active) return
    active = true
    previousActive = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', handleKeydown)
    // 等面板渲染出来再聚焦（open 切换的场景面板可能尚未出现在 DOM）
    requestAnimationFrame(() => panelRef.value?.focus())
  }

  function deactivate() {
    if (!active) return
    active = false
    document.removeEventListener('keydown', handleKeydown)
    previousActive?.focus?.()
    previousActive = null
  }

  if (enabled) {
    watch(enabled, (value) => (value ? activate() : deactivate()), { immediate: false })
    onMounted(() => {
      if (enabled.value) activate()
    })
  } else {
    onMounted(activate)
  }

  onUnmounted(deactivate)
}
