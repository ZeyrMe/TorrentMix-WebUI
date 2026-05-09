export type BackendSettingsTabId =
  | 'transfer'
  | 'connection'
  | 'queue'
  | 'port'
  | 'protocol'
  | 'seeding'
  | 'paths'

export function resolveInitialBackendSettingsTab(
  tabs: Array<{ id: BackendSettingsTabId }>,
  requested?: BackendSettingsTabId,
): BackendSettingsTabId {
  if (requested && tabs.some(tab => tab.id === requested)) {
    return requested
  }

  const transferTab = tabs.find(tab => tab.id === 'transfer')
  if (transferTab) return transferTab.id

  return tabs[0]?.id ?? 'transfer'
}
