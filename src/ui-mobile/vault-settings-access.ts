export type VaultSettingsAccess = 'quick-switch' | 'manage-button'

/** Phone settings have room for the full switcher; tablet settings retain the
 * compact entry point into the same canonical vault manager. */
export function vaultSettingsAccessForLayout(isPhoneLayout: boolean): VaultSettingsAccess {
  return isPhoneLayout ? 'quick-switch' : 'manage-button'
}

/** The Vault Location row's own actions: the first direct child of the row
 * that is, or holds, a button. Core has shipped both shapes, bare buttons in
 * the row before 2.58.0 and one wrapping button group since (#871). Looking
 * for a direct child, not the first button, is what keeps the island
 * mountable: a nested button is not a child of the row, insertBefore throws
 * on it, and the island silently never appeared on the phone. The island is
 * skipped so its own buttons never count as the row's. */
export function vaultRowActionGroup(row: Element, island: Element): Element | null {
  for (const child of Array.from(row.children)) {
    if (child === island) continue
    if (child.tagName === 'BUTTON' || child.querySelector('button')) return child
  }
  return null
}

/** Mount a vault island into the Vault Location row.
 *
 * Phone: between the label and the row's actions, so the card reads
 * location, picker list, actions, and mobile.css hides the row's actions
 * after the island in favor of the island's own group.
 *
 * Tablet: at the end of the row's button group, so Manage… sits beside
 * Change… instead of wrapping onto a line of its own. With bare buttons the
 * row itself is the group. */
export function placeVaultSettingsIsland(
  row: Element,
  island: Element,
  access: VaultSettingsAccess
): void {
  const actions = vaultRowActionGroup(row, island)
  if (access === 'quick-switch') row.insertBefore(island, actions)
  else if (actions && actions.tagName !== 'BUTTON') actions.appendChild(island)
  else row.appendChild(island)
}
