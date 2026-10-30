/** One spring sampled into a CSS `linear()` easing, with the numbers it came from. */
export interface SpringCurve {
  readonly duration: number
  readonly easing: string
  readonly stiffness: number
  readonly damping: number
}

// A damped spring (mass 1) sampled into a CSS linear() easing, for WAAPI glides
// and CSS transitions alike. Copied into packages/ui so kit CSS stays free of client/.
export function springEasing(stiffness: number, damping: number): SpringCurve {
  const w0 = Math.sqrt(stiffness)
  const zeta = damping / (2 * w0)
  const at = (t: number): number => {
    if (zeta >= 1) return 1 - (1 + w0 * t) * Math.exp(-w0 * t)
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
  }
  let end = 0.05
  while (end < 2 && Math.abs(1 - at(end)) > 0.001) end += 0.01
  const points = Array.from({ length: 25 }, (_, index) => (index === 24 ? 1 : at((end * index) / 24)).toFixed(4))
  return { duration: Math.round(end * 1000), easing: `linear(${points.join(',')})`, stiffness, damping }
}

export const SPRING_SHAPE = springEasing(400, 31.2)
export const SPRING_TAP = springEasing(900, 48)

export const spring = (curve: SpringCurve, ...properties: readonly string[]): string =>
  properties.map(property => `${property} ${curve.duration}ms ${curve.easing}`).join(',')
