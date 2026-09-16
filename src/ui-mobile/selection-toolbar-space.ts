type Rect = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>

export function selectionToolbarInset(editor: Rect, toolbar: Rect | null): number {
  if (!toolbar || toolbar.top >= editor.bottom || toolbar.bottom <= editor.top ||
      toolbar.left >= editor.right || toolbar.right <= editor.left) return 0
  return Math.ceil(Math.min(editor.bottom - editor.top, editor.bottom - toolbar.top + 8))
}
