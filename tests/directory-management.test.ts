import test from 'node:test'
import assert from 'node:assert/strict'

import type { Category } from '../src/adapter/types.ts'
import { buildDirectoryManagementModel } from '../src/utils/directoryManagement.ts'
import { buildFolderTree, VIRTUAL_ROOT_EXTERNAL } from '../src/utils/folderTree.ts'

test('directory management: builds model from backendStore categories including default and external directories', () => {
  const categories = new Map<string, Category>([
    ['', { name: '', savePath: '/downloads' }],
    ['movies/action', { name: 'movies/action', savePath: '' }],
    [`${VIRTUAL_ROOT_EXTERNAL}/archive`, { name: `${VIRTUAL_ROOT_EXTERNAL}/archive`, savePath: '' }],
  ])

  const model = buildDirectoryManagementModel(categories)

  assert.deepEqual(model.paths, ['', 'movies/action', `${VIRTUAL_ROOT_EXTERNAL}/archive`])
  assert.equal(model.defaultSavePath, '/downloads')
  assert.equal(model.hasDefaultDirectory, true)
  assert.equal(model.hasExternalDirectories, true)
})

test('directory management: folder tree preserves default root and external root branches', () => {
  const tree = buildFolderTree([
    '',
    'movies/action',
    `${VIRTUAL_ROOT_EXTERNAL}/archive`,
  ])

  assert.equal(tree.hasRoot, true)
  assert.equal(tree.nodes.some(node => node.path === 'movies'), true)
  assert.equal(tree.nodes.some(node => node.path === VIRTUAL_ROOT_EXTERNAL), true)
})
