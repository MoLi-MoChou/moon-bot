/** Types extracted. */

// [cx, cy, width, height, tilt]: the two capsules cut out of every layer.
export type Eye = readonly [number, number, number, number, number]
// A decal in a fixed color: path, fill, opacity.
export type Paint = readonly [string, string, number]
// One character as the table states it: the body path, its layers and its eyes.
export interface CharacterDef {
  label?: string
  body: string
  paints?: readonly Paint[]
  shade?: string
  light?: string
  eyes: readonly Eye[]
}
// A shape the renderer can draw: a body path or a markup function, its layers, and the
// mask it cuts. Plugins register their own through this surface.
export interface ShapeDef {
  label: string
  size: number
  path?: string
  layers?: string
  eyes: readonly Eye[]
  body?: (paint: string) => string
  wrap?: string
}
// The Bot fields a look is read from; everything else on a Bot is not this module's.
export interface LookBot {
  id?: string
  color?: unknown
  avatar?: unknown
}
