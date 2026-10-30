// The connector catalog (2026-10-27 connector-market): the data itself is the contract —
// every entry must name a mount the capability system accepts, and every secret its
// config references must be a slot the install form offers, or a one-click install
// would save a capability that cannot start.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONNECTOR_CATALOG, capabilityOf, secretRefsOf } from 'moon-bot-contracts'

const SECRET_REF = /\$(?:MOON_BOT|DSH)_SECRET_([A-Z][A-Z0-9_]*)/g

test('every entry names a mount the capability system accepts', () => {
  for (const entry of CONNECTOR_CATALOG) {
    assert.match(entry.id, /^[a-z][a-z0-9-]{0,31}$/, `${entry.id} is a valid capability name`)
    if (entry.transport === 'stdio')
      assert.ok(entry.command !== undefined && entry.command !== '', `${entry.id} names a command`)
    else assert.ok(entry.url !== undefined && entry.url.startsWith('https://'), `${entry.id} names an https url`)
  }
  assert.equal(new Set(CONNECTOR_CATALOG.map(entry => entry.id)).size, CONNECTOR_CATALOG.length, 'ids are unique')
})

test('every secret a config references is a slot the install form offers', () => {
  for (const entry of CONNECTOR_CATALOG) {
    const slots = new Set((entry.secrets ?? []).map(secret => secret.name))
    for (const ref of secretRefsOf(entry)) {
      assert.ok(slots.has(ref), `${entry.id} references ${ref} but offers no slot for it`)
    }
    // And the other way: a slot nobody references would puzzle the user filling it.
    for (const slot of slots)
      assert.ok(secretRefsOf(entry).includes(slot), `${entry.id} offers ${slot} but its config never uses it`)
  }
})

test('the capability item carries the config, not the secrets', () => {
  for (const entry of CONNECTOR_CATALOG) {
    const item = capabilityOf(entry) as Record<string, unknown>
    assert.equal(item.name, entry.id)
    assert.equal(item.kind, 'mcp')
    assert.equal(item.transport, entry.transport)
    const serialized = JSON.stringify(item)
    for (const ref of serialized.matchAll(SECRET_REF)) {
      assert.ok(
        (entry.secrets ?? []).some(secret => secret.name === ref[1]),
        `${entry.id} leaks an unnamed secret reference`,
      )
    }
  }
})
