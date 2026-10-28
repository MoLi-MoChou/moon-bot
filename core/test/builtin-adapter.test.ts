import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toToolDeclaration } from '@earendil-works/pi-ai'
import { piToolOf, toolSchemaOf } from '../src/engine/builtin/adapter.ts'
import type { ToolDefinition } from '../src/engine/builtin/services.ts'

test('toolSchemaOf normalizes empty parameters to a valid JSON Schema object', () => {
  const schema = toolSchemaOf({}) as { type: string; properties: Record<string, unknown>; required?: string[] }
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.properties, {})
  assert.equal(schema.required, undefined)
})

test('toolSchemaOf handles undefined and null gracefully', () => {
  const schemaNull = toolSchemaOf(null) as { type: string; properties: Record<string, unknown> }
  assert.equal(schemaNull.type, 'object')
  assert.deepEqual(schemaNull.properties, {})

  const schemaUndefined = toolSchemaOf(undefined) as { type: string; properties: Record<string, unknown> }
  assert.equal(schemaUndefined.type, 'object')
  assert.deepEqual(schemaUndefined.properties, {})
})

test('toolSchemaOf converts descriptive parameter maps to standard JSON Schema', () => {
  const schema = toolSchemaOf({
    to: { type: 'string', required: true, description: 'Exact Bot name from list_bots' },
    reply_to: { type: 'string', enum: ['me', 'user'], description: 'Reply routing' },
    members: { type: 'array', items: { type: 'string' }, required: true, description: 'Member list' },
  }) as {
    type: string
    properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string } }>
    required?: string[]
  }

  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.required, ['to', 'members'])
  assert.deepEqual(schema.properties.to, {
    type: 'string',
    description: 'Exact Bot name from list_bots',
  })
  assert.deepEqual(schema.properties.reply_to, {
    type: 'string',
    enum: ['me', 'user'],
    description: 'Reply routing',
  })
  assert.deepEqual(schema.properties.members, {
    type: 'array',
    items: { type: 'string' },
    description: 'Member list',
  })
})

test('toolSchemaOf preserves schemas that are already object JSON Schemas', () => {
  const input = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term' },
    },
    required: ['query'],
  }
  const schema = toolSchemaOf(input) as typeof input
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.properties, input.properties)
  assert.deepEqual(schema.required, ['query'])
})

test('piToolOf produces an AgentTool compatible with toToolDeclaration and OpenAI completions', () => {
  const listBotsDef: ToolDefinition = {
    name: 'list_bots',
    description: 'List every Bot on the user team',
    parameters: {},
    execute: async () => ({ content: [{ type: 'text', text: 'Chief' }] }),
  }

  const tool = piToolOf(listBotsDef, 'session-1')
  assert.equal(tool.name, 'list_bots')
  const decl = toToolDeclaration(tool)
  assert.equal(decl.name, 'list_bots')
  const params = decl.parameters as { type: string; properties: Record<string, unknown> }
  assert.equal(params.type, 'object')
  assert.deepEqual(params.properties, {})
})

test('toolSchemaOf normalizes nested schemas like ask_user without boolean required', () => {
  const askUserParams = {
    question: { type: 'string', required: true, description: 'One short question' },
    options: {
      type: 'array',
      required: true,
      description: 'Two to four answers',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', required: true, description: 'Short answer shown on the option' },
          description: { type: 'string', description: 'Optional one-line explanation under the label' },
        },
      },
    },
    detail: { type: 'string', description: 'Optional context' },
  }

  const schema = toolSchemaOf(askUserParams) as {
    type: string
    required?: string[]
    properties: {
      options: {
        type: string
        items: {
          type: string
          required?: string[]
          properties: {
            label: { type: string; required?: unknown }
          }
        }
      }
    }
  }

  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.required, ['question', 'options'])
  const items = schema.properties.options.items
  assert.equal(items.type, 'object')
  assert.deepEqual(items.required, ['label'])
  assert.equal(items.properties.label.required, undefined)

  // Verify no boolean required exists in serialized JSON
  const json = JSON.stringify(schema)
  assert.ok(!json.includes('"required":true'))
  assert.ok(!json.includes('"required":false'))
})
