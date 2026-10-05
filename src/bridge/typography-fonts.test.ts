import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { BUNDLED_FONT_FAMILIES, TYPOGRAPHY_FONT_FAMILIES } from './typography-fonts.ts'

const FONTS_DIR = new URL('../../public/fonts/', import.meta.url)
const INDEX_HTML = new URL('../../index.html', import.meta.url)
const LATIN_RANGE = 'U+0000-00FF'

type DeclaredFace = {
  family: string
  style: string
  url: string
  unicodeRange: string
}

function descriptor(block: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block)
  assert.ok(match, `@font-face without ${name}: ${block.trim()}`)
  return match[1].trim()
}

function declaredFaces(): DeclaredFace[] {
  const css = readFileSync(new URL('fonts.css', FONTS_DIR), 'utf8')
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, block]) => ({
    family: descriptor(block, 'font-family').replace(/^'|'$/g, ''),
    style: descriptor(block, 'font-style'),
    url: /url\(([^)]+)\)/.exec(descriptor(block, 'src'))?.[1] ?? '',
    unicodeRange: descriptor(block, 'unicode-range')
  }))
}

test('every Typography font menu offers both bundled families', () => {
  for (const family of BUNDLED_FONT_FAMILIES) {
    assert.ok(TYPOGRAPHY_FONT_FAMILIES.includes(family), `${family} is not offered`)
  }
  assert.equal(new Set(TYPOGRAPHY_FONT_FAMILIES).size, TYPOGRAPHY_FONT_FAMILIES.length)
})

test('each bundled family has upright and italic faces that cover Latin', () => {
  const faces = declaredFaces()
  for (const family of BUNDLED_FONT_FAMILIES) {
    for (const style of ['normal', 'italic']) {
      const latin = faces.find(
        (face) =>
          face.family === family &&
          face.style === style &&
          face.unicodeRange.split(/,\s*/).includes(LATIN_RANGE)
      )
      assert.ok(latin, `${family} has no ${style} Latin face`)
    }
  }
})

test('fonts.css declares faces only for families the menus offer', () => {
  const offered = new Set<string>(BUNDLED_FONT_FAMILIES)
  for (const face of declaredFaces()) {
    assert.ok(offered.has(face.family), `${face.family} is declared but never offered`)
  }
})

test('every face loads a shipped woff2 and every shipped woff2 is used', () => {
  const faces = declaredFaces()
  const referenced = new Set<string>()
  for (const face of faces) {
    // Root-relative: index.html sits at the WebView root (capacitor://localhost/).
    assert.match(face.url, /^\/fonts\/[a-z0-9-]+\.woff2$/, `unexpected face url ${face.url}`)
    referenced.add(face.url.slice('/fonts/'.length))
  }
  const shipped = readdirSync(FONTS_DIR).filter((name) => name.endsWith('.woff2'))
  assert.deepEqual([...referenced].sort(), [...shipped].sort())
  for (const name of shipped) {
    const signature = readFileSync(new URL(name, FONTS_DIR)).subarray(0, 4).toString('latin1')
    assert.equal(signature, 'wOF2', `${name} is not a woff2 file`)
  }
})

test('the Ubuntu Font Licence ships beside the fonts', () => {
  const licence = readFileSync(new URL('UFL.txt', FONTS_DIR), 'utf8')
  assert.match(licence, /UBUNTU FONT LICENCE Version 1\.0/)
})

test('index.html links the declarations ahead of the app entry', () => {
  const html = readFileSync(INDEX_HTML, 'utf8')
  const link = html.indexOf('<link rel="stylesheet" href="/fonts/fonts.css" />')
  const entry = html.indexOf('<script type="module"')
  assert.ok(link >= 0, 'index.html does not link /fonts/fonts.css')
  assert.ok(entry > link, 'the font declarations load after the app entry')
})
