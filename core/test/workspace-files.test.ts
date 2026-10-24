import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { install, isInside, mimeOf, readForDownload, zip } from '../src/host/workspace-files.ts'
import { formatBytes, mediaKind, typeLabel } from '../src/client/files-panel.ts'

const folder = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'moon-files-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// Reads back a zip's entries from its central directory.
function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buffer.readUInt16LE(end + 10)
  let at = buffer.readUInt32LE(end + 16)
  const out = {}
  for (let index = 0; index < count; index++) {
    const method = buffer.readUInt16LE(at + 10)
    const size = buffer.readUInt32LE(at + 20)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extra = buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32)
    const offset = buffer.readUInt32LE(at + 42)
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const localStart = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28)
    const body = buffer.subarray(localStart, localStart + size)
    out[name] = method === 8 ? inflateRawSync(body).toString('utf8') : body.toString('utf8')
    at += 46 + nameLength + extra
  }
  return out
}

test('a folder downloads as a zip with every file and empty folder in it', async (t) => {
  const dir = folder(t)
  mkdirSync(join(dir, 'proj', 'src'), { recursive: true })
  mkdirSync(join(dir, 'proj', 'empty'))
  writeFileSync(join(dir, 'proj', 'a.txt'), 'hello '.repeat(200))
  writeFileSync(join(dir, 'proj', 'src', '中文.md'), '# 你好')
  const file = await readForDownload(join(dir, 'proj'))
  assert.equal(file.name, 'proj.zip')
  assert.equal(file.mime, 'application/zip')
  const entries = unzip(Buffer.from(file.data, 'base64'))
  assert.equal(entries['proj/a.txt'], 'hello '.repeat(200))
  assert.equal(entries['proj/src/中文.md'], '# 你好')
  assert.ok('proj/empty/' in entries)
})

test('the zip opens with the system unzip', { skip: (() => { try { execFileSync('unzip', ['-v']); return false } catch { return 'no unzip' } })() }, (t) => {
  const dir = folder(t)
  writeFileSync(join(dir, 'z.zip'), zip([{ name: 'x/one.txt', data: Buffer.from('1') }, { name: 'x/two.bin', data: Buffer.alloc(5000, 7) }]))
  const listing = execFileSync('unzip', ['-t', join(dir, 'z.zip')]).toString()
  assert.match(listing, /No errors detected/)
})

test('a file downloads with its name, type and bytes', async (t) => {
  const dir = folder(t)
  writeFileSync(join(dir, 'tone.mp3'), Buffer.from([1, 2, 3]))
  const file = await readForDownload(join(dir, 'tone.mp3'))
  assert.deepEqual({ name: file.name, mime: file.mime, size: file.size }, { name: 'tone.mp3', mime: 'audio/mpeg', size: 3 })
  assert.deepEqual([...Buffer.from(file.data, 'base64')], [1, 2, 3])
})

test('only files inside the team\'s folders are served, symlinks included', async (t) => {
  const dir = folder(t)
  const work = join(dir, 'work')
  const outside = join(dir, 'secret.txt')
  mkdirSync(work)
  writeFileSync(join(work, 'ok.txt'), 'ok')
  writeFileSync(outside, 'no')
  symlinkSync(outside, join(work, 'link.txt'))
  const rt = { ctx: { workspaceRegistry: { list: () => [{ path: work }] } }, state: { bots: {}, rooms: {} } }
  install(rt)
  assert.equal(Buffer.from((await rt.workspaceDownload(join(work, 'ok.txt'))).data, 'base64').toString(), 'ok')
  await assert.rejects(rt.workspaceDownload(outside), /Only files in the team/)
  await assert.rejects(rt.workspaceDownload(join(work, 'link.txt')), /Only files in the team/)
  await assert.rejects(rt.workspaceDownload(join(work, '..', 'secret.txt')), /Only files in the team/)
  assert.equal((await rt.workspaceDescribe(join(work, 'ok.txt'))).size, 2)
})

test('helpers', () => {
  assert.ok(isInside('/a/b', '/a/b/c'))
  assert.ok(!isInside('/a/b', '/a/bc'))
  assert.equal(mimeOf('x.MP4'), 'video/mp4')
  assert.equal(mediaKind('a.wav'), 'audio')
  assert.equal(mediaKind('a.webm'), 'video')
  assert.equal(mediaKind('a.bin'), null)
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(20 * 1024 * 1024), '20 MB')
  assert.equal(typeLabel('a.zip', 'application/zip'), 'ZIP archive')
})
