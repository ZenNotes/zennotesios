/**
 * Return on an empty Board card field closes it.
 *
 * Core's Add card field adds a card on Enter and stays open for the next
 * (DatabaseBoardView), and with nothing typed it does nothing. Escape is the
 * way out, which a soft keyboard does not have, so the field and the keyboard
 * stayed up until a tap landed somewhere else. The shell turns that Return into
 * core's own Escape and lowers the keyboard. Return with a title still adds the
 * card and keeps the field, for the next one.
 */
import { Keyboard } from '@capacitor/keyboard'

export const BOARD_CARD_FIELD = 'input[aria-label^="New card in "]'

export interface CardFieldKey {
  key: string
  isComposing: boolean
  keyCode: number
}

export function closesCardField(event: CardFieldKey, value: string): boolean {
  return event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && value.trim() === ''
}

export function installBoardCardReturn(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const field = event.target
    if (!(field instanceof HTMLInputElement) || !field.matches(BOARD_CARD_FIELD)) return
    if (!closesCardField(event, field.value)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    void Keyboard.hide().catch(() => {})
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
