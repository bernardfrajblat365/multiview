// Writes the GitHub release text for a version (used by windows-release.yml).
// Usage: node --experimental-strip-types scripts/release-body.ts <version> [out-file]
// Without out-file it prints to stdout.
import { readFileSync, writeFileSync } from 'node:fs'
import { buildReleaseBody } from '../electron/release-notes.ts'
import { RELEASES } from '../src/release-notes.ts'

const version = (process.argv[2] ?? '').trim().replace(/^v/i, '')
const release = RELEASES.find((entry) => entry.version === version)
if (!release) {
  console.error(`Sem notas para a versão "${version}" em src/release-notes.ts.`)
  process.exit(1)
}
const install = readFileSync(new URL('../.github/release-install.md', import.meta.url), 'utf8')
const body = buildReleaseBody(release.notes, install)
const out = process.argv[3]
if (out) writeFileSync(out, body, 'utf8')
else process.stdout.write(body)
