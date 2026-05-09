import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

import { useBackendStore } from '../src/store/backend.ts'

test('backend taxonomy: qBittorrent exposes category management semantics', () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  backend.setAdapter(
    {} as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any,
  )

  assert.equal(backend.taxonomyFacet.kind, 'category')
  assert.equal(backend.taxonomyFacet.filterLabel, '分类')
  assert.equal(backend.taxonomyFacet.allFilterLabel, '全部分类')
  assert.equal(backend.taxonomyFacet.rootFilterLabel, '未分类')
  assert.equal(backend.taxonomyFacet.managementTitle, '分类管理')
  assert.equal(backend.taxonomyFacet.canOpenManagement, true)
  assert.equal(backend.taxonomyFacet.canSetTorrentCategory, true)
})

test('backend taxonomy: Transmission still exposes management entry while category editing stays disabled', () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  backend.setAdapter(
    {} as any,
    { type: 'trans', version: '4.1.0', major: 4, minor: 1, patch: 0 } as any,
  )

  assert.equal(backend.isQbit, false)
  assert.equal(backend.taxonomyFacet.kind, 'directory')
  assert.equal(backend.taxonomyFacet.filterLabel, '目录')
  assert.equal(backend.taxonomyFacet.allFilterLabel, '全部目录')
  assert.equal(backend.taxonomyFacet.rootFilterLabel, '默认目录')
  assert.equal(backend.taxonomyFacet.managementTitle, '目录管理')
  assert.equal(backend.taxonomyFacet.canOpenManagement, true)
  assert.equal(backend.taxonomyFacet.canSetTorrentCategory, false)
})
