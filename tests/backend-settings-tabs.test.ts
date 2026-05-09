import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveInitialBackendSettingsTab } from '../src/utils/backendSettingsTabs.ts'

test('backend settings tabs: prefers requested initial tab when visible', () => {
  const tabs = [
    { id: 'transfer' as const },
    { id: 'paths' as const },
  ]

  assert.equal(resolveInitialBackendSettingsTab(tabs, 'paths'), 'paths')
})

test('backend settings tabs: falls back to transfer when requested tab is unavailable', () => {
  const tabs = [
    { id: 'transfer' as const },
    { id: 'queue' as const },
  ]

  assert.equal(resolveInitialBackendSettingsTab(tabs, 'paths'), 'transfer')
})

test('backend settings tabs: falls back to first visible tab when transfer is hidden', () => {
  const tabs = [
    { id: 'paths' as const },
    { id: 'seeding' as const },
  ]

  assert.equal(resolveInitialBackendSettingsTab(tabs), 'paths')
})
