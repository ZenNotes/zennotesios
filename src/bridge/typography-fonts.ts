/**
 * The families Settings → Typography offers for the interface, text and
 * monospace fonts (`window.zen.listSystemFonts`). WKWebView has no font
 * enumeration, so the list is curated.
 *
 * The bundled families are not part of iOS: public/fonts ships them as
 * woff2 subsets with @font-face rules in fonts.css, linked from index.html.
 * They are the files the Android shell ships, under the Ubuntu Font Licence
 * 1.0 (public/fonts/UFL.txt). A family offered here without its faces would
 * fall back to the next font in the stack without a word.
 */
export const BUNDLED_FONT_FAMILIES = ['Ubuntu Sans', 'Ubuntu Sans Mono'] as const

export const TYPOGRAPHY_FONT_FAMILIES: readonly string[] = [
  'Avenir',
  'Charter',
  'Georgia',
  'Helvetica Neue',
  'Iowan Old Style',
  'Menlo',
  'New York',
  'Palatino',
  'SF Mono',
  'SF Pro Text',
  'Times New Roman',
  ...BUNDLED_FONT_FAMILIES
]
