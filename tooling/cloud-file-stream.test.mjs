import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))

it('verifies production Swift file integrity and confinement with real Foundation streams', {
  skip: process.platform !== 'darwin', timeout: 120_000
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-file-native-tests-'))
  try {
    const binary = join(directory, 'tests')
    await exec('xcrun', ['swiftc', 'ios/App/App/CloudFileStream.swift', 'tooling/cloud-file-stream-tests.swift', '-o', binary], { cwd: root })
    await exec(binary, [], { timeout: 30_000 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
