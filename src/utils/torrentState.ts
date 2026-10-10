import type { UnifiedTorrent } from '@/adapter/types'

export type TorrentStateKey = UnifiedTorrent['state']

export interface TorrentStateMeta {
  /** 中文状态文案 */
  label: string
  /** Icon 组件的图标名 */
  icon: string
  /** Icon 组件的 color prop */
  color: 'blue' | 'cyan' | 'gray' | 'orange' | 'purple' | 'red'
  /** 文本颜色（完整类名，避免动态拼接被 Tailwind JIT 摇掉） */
  textClass: string
  /** 状态徽章背景（完整类名） */
  bgClass: string
}

/**
 * 种子状态 → 展示元数据的唯一权威映射。
 * TorrentRow / TorrentCard / Dashboard 侧栏统一从这里取，禁止各处再手写。
 */
export const TORRENT_STATE_META: Record<TorrentStateKey, TorrentStateMeta> = {
  downloading: { label: '下载中', icon: 'download', color: 'blue', textClass: 'text-blue-500', bgClass: 'bg-blue-50' },
  seeding: { label: '做种中', icon: 'upload-cloud', color: 'cyan', textClass: 'text-cyan-500', bgClass: 'bg-cyan-50' },
  paused: { label: '已暂停', icon: 'pause-circle', color: 'gray', textClass: 'text-slate-500', bgClass: 'bg-slate-100' },
  queued: { label: '队列中', icon: 'clock', color: 'orange', textClass: 'text-orange-500', bgClass: 'bg-orange-50' },
  checking: { label: '检查中', icon: 'refresh-cw', color: 'purple', textClass: 'text-purple-500', bgClass: 'bg-purple-50' },
  error: { label: '错误', icon: 'alert-circle', color: 'red', textClass: 'text-red-500', bgClass: 'bg-red-50' },
}

export function getStateMeta(state: TorrentStateKey): TorrentStateMeta {
  return TORRENT_STATE_META[state]
}
