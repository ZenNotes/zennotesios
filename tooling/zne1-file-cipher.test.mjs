import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))

it('seals and opens ZNE1 files byte for byte with the shared vectors and refuses tampered input', {
  skip: process.platform !== 'darwin', timeout: 180_000
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zne1-native-tests-'))
  try {
    const binary = join(directory, 'tests')
    await exec('xcrun', ['swiftc', 'ios/App/App/CloudFileStream.swift', 'tooling/zne1-file-cipher-tests.swift', '-o', binary], { cwd: root })
    await exec(binary, ['tooling/cloud-e2ee-vectors.json'], { cwd: root, timeout: 60_000 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
