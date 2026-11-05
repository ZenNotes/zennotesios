/**
 * Core's Help button in the sidebar footer, found by its own data hook. The footer
 * has no hook of its own: it was found by `zn-sidebar-footer-safe` until core
 * 9e989aad dropped that class with its inset, and Commands quietly stopped showing.
 */
export const SIDEBAR_HELP_BUTTON = 'button[data-sidebar-type="help"]'

/**
 * The cell left of Help that Commands sits in. Core leaves it empty when it has no
 * Files action; a button there means it has one, and the footer has no room to give.
 */
export function sidebarCommandsSlot(root: Pick<ParentNode, 'querySelector'>): Element | null {
  const slot = root.querySelector(SIDEBAR_HELP_BUTTON)?.previousElementSibling
  return slot?.tagName === 'DIV' ? slot : null
}
