import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeGithubOutput } from '../../src/github/output.ts'

test('writeGithubOutput appends key=value lines and no-ops without GITHUB_OUTPUT', () => {
  const previous = process.env.GITHUB_OUTPUT
  delete process.env.GITHUB_OUTPUT
  writeGithubOutput({ status: 'compatible' })
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mig-out-'))
  const file = join(dir, 'github-output')
  process.env.GITHUB_OUTPUT = file
  try {
    writeGithubOutput({ status: 'migrated', issue_url: 'https://example.test/i/1' })
    const text = readFileSync(file, 'utf8')
    assert.match(text, /^status=migrated$/m)
    assert.match(text, /^issue_url=https:\/\/example\.test\/i\/1$/m)

    // A value with a newline is written with the heredoc form, and the delimiter
    // is drawn per write: a fixed one is a line a value could contain, and
    // everything after it would be read as the next output.
    writeGithubOutput({ command_reply: 'line one\nline two' })
    const multi = readFileSync(file, 'utf8').split('\n')
    const opener = multi.find(line => line.startsWith('command_reply<<'))
    assert.notEqual(opener, undefined)
    const delimiter = (opener ?? '').slice('command_reply<<'.length)
    assert.match(delimiter, /^MIGRATE_EOF_[0-9a-f]{32}$/)
    assert.equal(multi.filter(line => line === delimiter).length, 1)
  } finally {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT
    else process.env.GITHUB_OUTPUT = previous
    rmSync(dir, { recursive: true, force: true })
  }
})
