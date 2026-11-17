/** DOM id of one tab in a `FilterTabs` strip (see filter-tabs.tsx). */
export function filterTabId(panelId: string, key: string): string {
  return `${panelId}-tab-${key || 'all'}`
}
