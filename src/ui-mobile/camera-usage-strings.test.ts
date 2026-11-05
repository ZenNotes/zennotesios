import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// The attach button's file input offers Take Photo or Video through WKWebView.
// iOS ends the app, with no error to catch, the moment that reaches the camera
// or microphone without these strings. App Review rejected 1.37.0 for it.
const plist = readFileSync('ios/App/App/Info.plist', 'utf8')

for (const key of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription']) {
  test(`Info.plist explains ${key}`, () => {
    assert.match(plist, new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`))
  })
}
