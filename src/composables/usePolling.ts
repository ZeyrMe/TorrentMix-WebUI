import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import { isFatalError } from '@/api/client'

/**
 * 轮询状态
 */
export interface PollingOptions {
  /** 基础轮询间隔（毫秒），默认 2000ms */
  baseInterval?: number
  /** 最大轮询间隔（毫秒），默认 30000ms */
  maxInterval?: number
  /** 熔断阈值：连续失败多少次后暂停，默认 5 次 */
  circuitBreakerThreshold?: number
  /** 熔断后暂停时间（毫秒），默认 60000ms */
  circuitBreakerDelay?: number
  /** 是否在页面隐藏时暂停轮询，默认 true */
  pauseWhenHidden?: boolean
  /** 遇到致命错误时的回调（如 403），轮询将立即停止 */
  onFatalError?: (error: Error) => void
  /** 是否跳过本轮轮询（例如全局正在执行写操作） */
  shouldSkip?: () => boolean
  /** 轮询函数 */
  fn: () => Promise<void>
}

/**
 * 轮询控制器返回值
 */
export interface PollingController {
  /** 开始轮询 */
  start: () => void
  /** 停止轮询 */
  stop: () => void
  /** 是否正在轮询 */
  isPolling: Readonly<Ref<boolean>>
  /** 当前轮询间隔（毫秒） */
  currentInterval: Readonly<Ref<number>>
  /** 连续失败次数 */
  failureCount: Readonly<Ref<number>>
  /** 是否已熔断 */
  isCircuitBroken: Readonly<Ref<boolean>>
}

/**
 * 智能轮询 Composable
 *
 * 特性：
 * - 指数退避：失败时 interval *= 2，最大 maxInterval
 * - 熔断器：连续失败 circuitBreakerThreshold 次后暂停 circuitBreakerDelay 毫秒
 * - 页面可见性：页面隐藏时暂停轮询，显示时恢复
 * - 自动恢复：成功时重置所有状态
 * - 致命错误：遇到 AuthError 等致命错误时立即停止轮询
 *
 * @example
 * ```ts
 * const { start, stop, isPolling } = usePolling({
 *   fn: async () => {
 *     await backendStore.adapter!.fetchList()
 *   },
 *   baseInterval: 2000,
 *   maxInterval: 30000
 * })
 *
 * onMounted(() => start())
 * onUnmounted(() => stop())
 * ```
 */
export function usePolling(options: PollingOptions): PollingController {
  const {
    baseInterval = 2000,
    maxInterval = 30000,
    circuitBreakerThreshold = 5,
    circuitBreakerDelay = 60000,
    pauseWhenHidden = true,
    onFatalError,
    shouldSkip,
    fn
  } = options

  const isPolling = ref(false)
  const currentInterval = ref(baseInterval)
  const failureCount = ref(0)
  const isCircuitBroken = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let circuitBreakerTimer: ReturnType<typeof setTimeout> | null = null
  let isPaused = false
  // 单飞守卫：防止可见性恢复的立即 tick 与在途 tick 并发出两条轮询链
  let isTicking = false

  /**
   * 失败时指数退避
   */
  function backoff() {
    failureCount.value++

    // 指数退避
    currentInterval.value = Math.min(baseInterval * 2 ** failureCount.value, maxInterval)

    // 达到熔断阈值
    if (failureCount.value >= circuitBreakerThreshold) {
      isCircuitBroken.value = true
      currentInterval.value = circuitBreakerDelay

      // 熔断后延迟恢复
      circuitBreakerTimer = setTimeout(() => {
        failureCount.value = 0
        isCircuitBroken.value = false
        currentInterval.value = baseInterval
      }, circuitBreakerDelay)
    }
  }

  /**
   * 成功时重置状态
   */
  function reset() {
    failureCount.value = 0
    currentInterval.value = baseInterval
    isCircuitBroken.value = false

    // 清除熔断定时器
    if (circuitBreakerTimer) {
      clearTimeout(circuitBreakerTimer)
      circuitBreakerTimer = null
    }
  }

  /**
   * 执行单次轮询
   */
  async function tick() {
    if (isPaused || !isPolling.value || isTicking) return

    // 主动跳过：例如正在进行写操作，避免轮询与操作互相“打架”导致 UI 闪回
    if (shouldSkip && shouldSkip()) {
      if (isPolling.value) {
        timer = setTimeout(tick, currentInterval.value)
      }
      return
    }

    isTicking = true
    try {
      await fn()
      reset()
    } catch (error) {
      // 检查是否为致命错误（如 AuthError）
      if (onFatalError && isFatalError(error)) {
        stop()  // 立即停止轮询
        onFatalError(error as Error)
        return
      }
      backoff()
    } finally {
      isTicking = false
    }

    // 调度下一次轮询
    if (isPolling.value) {
      timer = setTimeout(tick, currentInterval.value)
    }
  }

  /**
   * 开始轮询
   */
  function start() {
    if (isPolling.value) return

    isPolling.value = true
    void tick() // 立即执行一次
  }

  /**
   * 停止轮询
   */
  function stop() {
    isPolling.value = false

    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    if (circuitBreakerTimer) {
      clearTimeout(circuitBreakerTimer)
      circuitBreakerTimer = null
    }
  }

  /**
   * 页面可见性监听
   */
  if (pauseWhenHidden) {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        isPaused = true
      } else {
        isPaused = false
        // 页面恢复时立即执行一次；先清掉隐藏期间遗留的 pending timer，避免双轮询链
        if (isPolling.value) {
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
          void tick()
        }
      }
    }

    onMounted(() => {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    })

    onUnmounted(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    })
  }

  // 组件卸载时清理
  onUnmounted(() => {
    stop()
  })

  return {
    start,
    stop,
    isPolling,
    currentInterval,
    failureCount,
    isCircuitBroken
  }
}
