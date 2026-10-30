// What a Bot sees when its own reminder fires.
//
// Delivered bare, the stored note read like a message from the user, so the Bot answered it
// like one: "该更新线上环境了。" — flat, and stripped of whatever warmth it would have used.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reminderText } from '../src/service/reminder-text.ts'

const task = { title: '更新线上环境', prompt: '提醒用户更新线上环境' }

test('the Bot is told it set this itself', () => {
  // Without this it reads the note as the user talking and replies to the note.
  const text = reminderText(task)
  assert.match(text, /\[YOUR OWN REMINDER\]/)
  assert.match(text, /You set this earlier/)
})

test('it is told to say it in passing, in the user\'s language', () => {
  const text = reminderText(task)
  assert.match(text, /one or two short sentences/)
  assert.match(text, /in their language/)
})

test('it is told not to read the note back or explain the machinery', () => {
  const text = reminderText(task)
  assert.match(text, /do not read the note/i)
  assert.match(text, /Do not explain that a reminder fired/i)
})

test('the note travels with it so the Bot knows what it was about', () => {
  assert.match(reminderText(task), /提醒用户更新线上环境/)
})

test('an empty note falls back to the title rather than saying nothing', () => {
  const text = reminderText({ title: 'Stand up', prompt: '' })
  assert.match(text, /what you noted: Stand up/)
})

test('the title is still carried, for the Bot\'s own context', () => {
  assert.match(reminderText(task), /更新线上环境/)
})
