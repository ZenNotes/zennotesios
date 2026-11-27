import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'

// A self-hosted server can sit at any address the user types: a Mac on the
// LAN, a NAS name, or a mesh VPN address such as NetBird's or Tailscale's
// 100.64.0.0/10 range (zennotesios#105). NSAllowsLocalNetworking only lets
// plain HTTP through to RFC 1918 addresses, .local names and bare host names,
// and ATS exception domains cannot name an IP range, so the app allows plain
// HTTP everywhere (as the Android app's network security config does) and
// lists ZenNotes Cloud's hosts as exception domains, which keeps full ATS
// (HTTPS, TLS 1.2, forward secrecy) on them.
//
// NSAllowsLocalNetworking must stay out: on iOS 10 and later its presence
// makes iOS ignore NSAllowsArbitraryLoads, which would bring the bug back.

const plist = 'ios/App/App/Info.plist'
const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }))
const ats = info.NSAppTransportSecurity as Record<string, unknown>

function cloudHosts(): string[] {
  const source = readFileSync('node_modules/@zennotes/portable-vault/dist/mobile-cloud-auth.js', 'utf8')
  return ['PRODUCTION_CLOUD_BASE_URL', 'LEGACY_CLOUD_BASE_URL'].map((name) => {
    const url = new RegExp(`const ${name} = '([^']+)'`).exec(source)?.[1]
    assert.ok(url, `${name} not found in @zennotes/portable-vault's mobile-cloud-auth.js`)
    return new URL(url).hostname
  })
}

it('allows plain HTTP to user-entered self-hosted servers', () => {
  assert.equal(ats.NSAllowsArbitraryLoads, true)
  for (const voiding of [
    'NSAllowsLocalNetworking',
    'NSAllowsArbitraryLoadsInWebContent',
    'NSAllowsArbitraryLoadsForMedia',
    'NSRequiresCertificateTransparency'
  ]) {
    assert.ok(!(voiding in ats), `${voiding} makes iOS ignore NSAllowsArbitraryLoads`)
  }
})

it('keeps full ATS on every ZenNotes Cloud host', () => {
  const exceptions = (ats.NSExceptionDomains ?? {}) as Record<string, Record<string, unknown>>
  for (const host of cloudHosts()) {
    const match = Object.entries(exceptions).find(
      ([domain, rules]) => host === domain || (rules.NSIncludesSubdomains === true && host.endsWith(`.${domain}`))
    )
    assert.ok(match, `${host} has no exception domain, so plain HTTP would be allowed to it`)
    const [domain, rules] = match
    assert.deepEqual(Object.keys(rules), ['NSIncludesSubdomains'], `${domain} must not relax any ATS rule`)
  }
})
