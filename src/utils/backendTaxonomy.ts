export type BackendTaxonomyKind = 'category' | 'directory'

export interface BackendTaxonomyFacet {
  kind: BackendTaxonomyKind
  filterLabel: string
  allFilterLabel: string
  rootFilterLabel: string
  managementTitle: string
  canOpenManagement: boolean
  canSetTorrentCategory: boolean
}

const DEFAULT_FACET: BackendTaxonomyFacet = {
  kind: 'category',
  filterLabel: '分类',
  allFilterLabel: '全部分类',
  rootFilterLabel: '',
  managementTitle: '分类管理',
  canOpenManagement: false,
  canSetTorrentCategory: false,
}

export function resolveBackendTaxonomyFacet(
  backendType: 'qbit' | 'trans' | null,
): BackendTaxonomyFacet {
  if (backendType === 'qbit') {
    return {
      kind: 'category',
      filterLabel: '分类',
      allFilterLabel: '全部分类',
      rootFilterLabel: '',
      managementTitle: '分类管理',
      canOpenManagement: true,
      canSetTorrentCategory: true,
    }
  }

  if (backendType === 'trans') {
    return {
      kind: 'directory',
      filterLabel: '目录',
      allFilterLabel: '全部目录',
      rootFilterLabel: '默认目录',
      managementTitle: '目录管理',
      canOpenManagement: true,
      canSetTorrentCategory: false,
    }
  }

  return DEFAULT_FACET
}
