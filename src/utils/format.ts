export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '--'
  // bytes 可能来自计算（如 size * progress），会出现 0 < bytes < 1 的浮点数；此时按 0 处理避免单位下标为负
  if (bytes < 1) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  const value = bytes / Math.pow(k, i)
  const digits = i === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${sizes[i]}`
}

export function formatSpeed(bytesPerSecond: number): string {
  const formatted = formatBytes(bytesPerSecond)
  return formatted === '--' ? '--' : `${formatted}/s`
}

/**
 * 格式化种子剩余时间（中文单位，供列表行/卡片共用）
 * 已完成、错误状态或无限时间显示 ∞
 */
export function formatEta(eta: number, progress: number, state: string): string {
  // 已完成或错误状态显示无限
  if (progress >= 1.0 || state === 'error') return '∞'

  // qBittorrent 用 -1 或 >= 100 天（8640000 秒）表示无限 ETA。
  if (eta === -1 || eta <= 0 || !isFinite(eta) || eta >= 8640000) return '∞'

  const seconds = Math.floor(eta)
  if (seconds < 60) return `${seconds}秒`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时`

  const days = Math.floor(hours / 24)
  return `${days}天`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--'
  // qBittorrent 用 -1 或 >= 8640000 (100天) 表示无限
  if (seconds === -1 || seconds >= 8640000) return '∞'
  if (seconds < 0) return '--'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}
