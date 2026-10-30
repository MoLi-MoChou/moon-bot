// The content blocks a turn event carries, and the attachments among them: what the
// router reads when a message lands inside a turn (a group post, a request, an image).
import type { AttachmentRef, MessageContentBlock } from '../host-types.js'

export const contentOf = (value: unknown): readonly MessageContentBlock[] =>
  Array.isArray(value) ? (value as readonly MessageContentBlock[]) : []

export const fileAttachments = (content: readonly MessageContentBlock[]): AttachmentRef[] =>
  content.flatMap(block =>
    block?.type === 'file' && block.attachment !== undefined ? [block.attachment as AttachmentRef] : [],
  )

export const imageAttachments = (content: readonly MessageContentBlock[]): AttachmentRef[] =>
  content.flatMap(block =>
    block?.type === 'image' && !block?.offloaded && block.attachment !== undefined
      ? [block.attachment as AttachmentRef]
      : [],
  )
