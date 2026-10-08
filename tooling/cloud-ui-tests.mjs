// Runs CloudFlowUITests against ZenNotes Cloud as the QA account. Its only vault,
// "Android Q", holds the seed notes the tests read (seeded 2026-10-08 from the
// Android emulator; copies in tooling/cloud-ui-fixtures), so keep them there. To
// re-seed, copy that folder into any vault linked to "Android Q" and sync it. The
// login comes from the macOS Keychain, never from a file or the command line; add
// it once with
//   security add-generic-password -a <QA account email> -s zennotes-cloud-e2e -w
// Every run erases its own simulator first, so the pull tests prove a real download.
// The terminal output masks the typed password, but the result bundle records it,
// so keep the bundle local.
//   npm run test:ui:cloud                          cap sync, then all Cloud flows
//   npm run test:ui:cloud -- --no-sync             test the web build already synced
//   npm run test:ui:cloud -- --only testPublishesExistingNote
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'

const SERVICE = 'zennotes-cloud-e2e'
const DEVICE_NAME = 'ZenNotes Cloud E2E'
const DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'

const outcomes = new Map()
const failures = new Map()
const screens = new Map()
let lastScreen = null
const args = process.argv.slice(2)
const only = valueAfter('--only')
const { email, password } = keychainAccount()

if (!args.includes('--no-sync')) run('npm', ['run', 'sync'])

const udid = freshSimulator()
const resultBundle = `ios/DerivedData/cloud-ui-tests-${new Date().toISOString().replace(/[:.]/g, '-')}.xcresult`
const status = await runMasked(
  'xcodebuild',
  [
    'test',
    '-workspace', 'ios/App/App.xcworkspace',
    '-scheme', 'AppCloudUITests',
    '-destination', `platform=iOS Simulator,id=${udid}`,
    '-derivedDataPath', 'ios/DerivedData',
    '-resultBundlePath', resultBundle,
    `-only-testing:AppUITests/CloudFlowUITests${only ? `/${only}` : ''}`
  ],
  {
    ...process.env,
    TEST_RUNNER_ZENNOTES_CLOUD_E2E_EMAIL: email,
    TEST_RUNNER_ZENNOTES_CLOUD_E2E_PASSWORD: password
  }
)

printReport()
console.log(`\nResult bundle: ${resultBundle}`)
console.log(`Summary: xcrun xcresulttool get test-results summary --path ${resultBundle}`)
process.exit(status)

function keychainAccount() {
  let attributes
  let secret
  try {
    attributes = execFileSync('security', ['find-generic-password', '-s', SERVICE], { encoding: 'utf8' })
    secret = execFileSync('security', ['find-generic-password', '-s', SERVICE, '-w'], { encoding: 'utf8' })
  } catch {
    fail(
      `No Keychain item "${SERVICE}". Add the QA account's login once with\n` +
        `  security add-generic-password -a <QA account email> -s ${SERVICE} -w`
    )
  }
  const account = /"acct"<blob>="([^"]+)"/.exec(attributes)?.[1]
  const value = secret.replace(/\n$/, '')
  if (!account || !value) fail(`The Keychain item "${SERVICE}" needs both an account (-a) and a password.`)
  return { email: account, password: value }
}

function freshSimulator() {
  const devices = Object.values(simctlJson('devices').devices).flat()
  let device = devices.find((candidate) => candidate.name === DEVICE_NAME && candidate.isAvailable)
  if (!device) {
    const runtime = simctlJson('runtimes').runtimes
      .filter((candidate) => candidate.platform === 'iOS' && candidate.isAvailable)
      .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
      .pop()
    if (!runtime) fail('No iOS simulator runtime is installed.')
    const created = execFileSync('xcrun', ['simctl', 'create', DEVICE_NAME, DEVICE_TYPE, runtime.identifier], {
      encoding: 'utf8'
    }).trim()
    device = { udid: created, state: 'Shutdown' }
  }
  if (device.state !== 'Shutdown') run('xcrun', ['simctl', 'shutdown', device.udid])
  run('xcrun', ['simctl', 'erase', device.udid])
  run('xcrun', ['simctl', 'boot', device.udid])
  run('xcrun', ['simctl', 'bootstatus', device.udid, '-b'])
  return device.udid
}

// XCUITest prints every string it types, the password included, so xcodebuild's output
// is streamed through here and any line that types into a secure field is masked.
// After a run with failures, xcodebuild has more than once stayed alive for many
// minutes past the suite's final line, so once that line is out it gets 90 seconds
// to exit before it is stopped and the suite's own verdict is returned.
function runMasked(command, commandArgs, env) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { stdio: ['inherit', 'pipe', 'pipe'], env })
    let verdict = null
    let stopped = false
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      createInterface({ input: stream }).on('line', (line) => {
        const shown = mask(line)
        sink.write(`${shown}\n`)
        record(shown)
        const suite = /^Test Suite 'Selected tests' (passed|failed) at/.exec(line)
        if (suite && verdict === null) {
          verdict = suite[1]
          setTimeout(() => {
            if (child.exitCode !== null || child.signalCode !== null) return
            console.error('\nxcodebuild did not exit 90 seconds after the tests finished; stopping it.')
            stopped = true
            child.kill('SIGTERM')
            setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 10_000).unref()
          }, 90_000).unref()
        }
      })
    }
    child.on('close', (code) => resolve(stopped ? (verdict === 'passed' ? 0 : 1) : code ?? 1))
  })
}

// The result bundle is only complete when xcodebuild exits on its own, so the run ends
// with its own report built from the output: each test's outcome and, for a failure,
// the line and message XCTest gave.
function record(line) {
  if (line.startsWith('SCREEN ')) lastScreen = line.slice('SCREEN '.length)
  const outcome = /^Test Case '-\[AppUITests\.CloudFlowUITests (\w+)\]' (passed|failed|skipped)/.exec(line)
  if (outcome) outcomes.set(outcome[1], outcome[2])
  const failure = /CloudFlowUITests\.swift:(\d+): error: -\[AppUITests\.CloudFlowUITests (\w+)\] : (.*)$/.exec(line)
  if (failure && !failures.has(failure[2])) {
    failures.set(failure[2], `line ${failure[1]}: ${failure[3]}`)
    if (lastScreen) screens.set(failure[2], lastScreen)
  }
  if (failure || outcome) lastScreen = null
}

function printReport() {
  if (outcomes.size === 0) return
  console.log('\nCloud UI tests')
  for (const [name, outcome] of outcomes) {
    console.log(`  ${outcome.padEnd(8)}${name}${failures.has(name) ? `  (${failures.get(name)})` : ''}`)
    if (screens.has(name)) console.log(`          on screen: ${screens.get(name)}`)
  }
}

function mask(line) {
  return line
    .replace(/Type '.*' into (.*SecureTextField)/, "Type '••••' into $1")
    .split(password)
    .join('••••')
}

function simctlJson(kind) {
  return JSON.parse(execFileSync('xcrun', ['simctl', 'list', kind, '--json'], { encoding: 'utf8' }))
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' })
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} exited with ${result.status}`)
}

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1] ?? fail(`${flag} needs a test name`)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
