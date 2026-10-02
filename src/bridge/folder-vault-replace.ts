/**
 * One Files folder vault at a time: folder-picker.ts keeps a single
 * security-scoped bookmark, so choosing another folder replaces the current
 * one, and the replaced folder drops out of the Vaults sheet while its notes
 * stay in Files. The picker used to do that without a word, and a vault the
 * person had been using simply vanished from the list. Every path to the
 * picker asks first with this copy, and the Vaults sheet states the rule
 * under Folders.
 *
 * No Capacitor imports, so the copy and the ask-then-pick order load in
 * node:test as they are.
 */

export interface FolderVaultReplaceNotice {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
}

/** The rule, stated once under the Vaults sheet's Folders section. */
export const FOLDER_VAULT_HINT = 'One Files folder at a time'

/** What to ask before the picker opens, or null when no folder vault is set
 *  and a pick replaces nothing. Names the folder as the Vaults sheet lists it. */
export function folderVaultReplaceNotice(
  current: { name: string } | null
): FolderVaultReplaceNotice | null {
  if (!current) return null
  return {
    title: 'Replace your Files folder vault?',
    body:
      `ZenNotes keeps one Files folder vault at a time. Choosing a new folder removes “${current.name}” ` +
      'from your vaults list. Its notes stay in Files, and you can choose that folder again anytime.',
    confirmLabel: 'Choose New Folder',
    cancelLabel: 'Cancel'
  }
}

/** Asks when there is a folder vault to replace, then picks. A declined
 *  notice resolves null and never opens the picker. */
export async function pickAfterReplaceNotice<T>(
  current: { name: string } | null,
  confirm: (notice: FolderVaultReplaceNotice) => Promise<boolean>,
  pick: () => Promise<T | null>
): Promise<T | null> {
  const notice = folderVaultReplaceNotice(current)
  if (notice && !(await confirm(notice))) return null
  return await pick()
}
