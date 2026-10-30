import { type Ref, createElement as h, useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
export const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
/** One spring sampled into a CSS `linear()` easing, with the numbers it came from. */
export interface SpringCurve {
    readonly duration: number;
    readonly easing: string;
    readonly stiffness: number;
    readonly damping: number;
}
// A damped spring (mass 1) sampled into a CSS linear() easing, for WAAPI glides
// and CSS transitions alike.
export function springEasing(stiffness: number, damping: number): SpringCurve {
    const w0 = Math.sqrt(stiffness);
    const zeta = damping / (2 * w0);
    const at = (t: number): number => {
        if (zeta >= 1)
            return 1 - (1 + w0 * t) * Math.exp(-w0 * t);
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
    };
    let end = 0.05;
    while (end < 2 && Math.abs(1 - at(end)) > 0.001)
        end += 0.01;
    const points = Array.from({ length: 25 }, (_, index) => (index === 24 ? 1 : at(end * index / 24)).toFixed(4));
    return { duration: Math.round(end * 1000), easing: `linear(${points.join(',')})`, stiffness, damping };
}
// The capsule's two springs: a gentle one (ω=20, ζ=0.78) reshapes surfaces, a
// tighter one (ω=30, ζ=0.8) answers the press.
export const SPRING_SHAPE = springEasing(400, 31.2);
export const SPRING_TAP = springEasing(900, 48);
// Rows of a list move to new places on ω=22, ζ=0.8.
export const SPRING_LIST = springEasing(484, 35.2);
// A looser spring (ω≈18, ζ≈0.56) that overshoots a little, for a surface that stretches
// open, and a quicker one for a mark that pops in.
export const SPRING_STRETCH = springEasing(320, 20);
export const SPRING_POP = springEasing(500, 22);
// A thumb's two edges: the one in front runs the fast spring (ω=28), the one behind
// the slower one (ω=17), so the thumb stretches into the move and settles behind it
// within about a quarter second.
export const SPRING_LEAD = springEasing(784, 48.2);
export const SPRING_TRAIL = springEasing(289, 29.2);
/** The two edges of a thumb that stretches into a move. */
export interface SpringEdges {
    readonly lead: SpringCurve;
    readonly trail: SpringCurve;
}
// A highlight that follows the keyboard and pointer down a list keeps up on stiffer
// edges (ω=30 and ω=20).
export const QUICK_EDGES: SpringEdges = { lead: springEasing(900, 51), trail: springEasing(400, 34) };
// Sidebar rows glide to new places on a stiffer spring (ω≈31.6, ζ≈1).
export const SPRING_ROW_GLIDE = springEasing(1000, 63);
// Browser panel tab indicator edges: leading edge stretches ahead, trailing edge settles.
export const PANEL_TAB_EDGES: SpringEdges = { lead: springEasing(576, 39.4), trail: springEasing(144, 19.7) };
// Unified exit durations (ms) and easing curves across menus, dialogs, sheets and panels.
export const MENU_EXIT_MS = 120;
export const DIALOG_EXIT_MS = 160;
export const SHEET_EXIT_MS = 220;
export const PANEL_LINGER_MS = 300;
export const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
export const EASE_IN = 'cubic-bezier(.4,0,1,1)';
export const EASE_PANEL = 'cubic-bezier(.2,0,0,1)';
/** The springs, durations and curves each kind of surface moves on. */
export interface MotionPresets {
    readonly sidebar: {
        readonly shape: SpringCurve;
        readonly rowGlide: SpringCurve;
        readonly easeOut: string;
    };
    readonly overlay: {
        readonly enter: SpringCurve;
        readonly exitMs: number;
        readonly sheetExitMs: number;
        readonly easeIn: string;
        readonly easeOut: string;
    };
    readonly menu: {
        readonly enter: SpringCurve;
        readonly exitMs: number;
        readonly easeIn: string;
    };
    readonly panel: {
        readonly shape: SpringCurve;
        readonly lingerMs: number;
        readonly ease: string;
        readonly tabEdges: SpringEdges;
    };
    readonly message: {
        readonly enter: SpringCurve;
        readonly collapseMs: number;
        readonly easeOut: string;
    };
}
export const MOTION_PRESETS: MotionPresets = Object.freeze({
    sidebar: Object.freeze({ shape: SPRING_SHAPE, rowGlide: SPRING_ROW_GLIDE, easeOut: EASE_OUT }),
    overlay: Object.freeze({ enter: SPRING_SHAPE, exitMs: DIALOG_EXIT_MS, sheetExitMs: SHEET_EXIT_MS, easeIn: EASE_IN, easeOut: EASE_OUT }),
    menu: Object.freeze({ enter: SPRING_TAP, exitMs: MENU_EXIT_MS, easeIn: EASE_IN }),
    panel: Object.freeze({ shape: SPRING_SHAPE, lingerMs: PANEL_LINGER_MS, ease: EASE_PANEL, tabEdges: PANEL_TAB_EDGES }),
    message: Object.freeze({ enter: SPRING_SHAPE, collapseMs: 240, easeOut: EASE_OUT }),
});
export const spring = (curve: SpringCurve, ...properties: readonly string[]): string => properties.map(property => `${property} ${curve.duration}ms ${curve.easing}`).join(',');
interface SpringValue {
    x: number;
    v: number;
    to: number;
    k: number;
    c: number;
}
/** Springs stepped once per frame, shared by every thumb a hook drives. */
interface LiveSprings {
    target(): Record<string, number> | null;
    set(targets: Record<string, number>, curves: Record<string, SpringCurve>, jump: boolean): void;
    stop(): void;
}
// Springs stepped once per frame. A new target keeps the current velocity, so a thumb
// that is sent somewhere else mid-move turns smoothly instead of starting over. Each
// frame covers the whole time since the last one, like a CSS transition, so a busy
// page delays the thumb instead of slowing it down.
function liveSprings(apply: (values: Record<string, number>) => void): LiveSprings {
    const values = new Map<string, SpringValue>();
    let frame = 0;
    let last = 0;
    const read = (): Record<string, number> => Object.fromEntries([...values].map(([key, value]) => [key, value.x]));
    const step = (now: number): void => {
        const dt = Math.min(0.5, Math.max(0.001, (now - last) / 1000));
        last = now;
        const steps = Math.ceil(dt * 240);
        const slice = dt / steps;
        let moving = false;
        for (const value of values.values()) {
            for (let index = 0; index < steps; index += 1) {
                value.v += (-value.k * (value.x - value.to) - value.c * value.v) * slice;
                value.x += value.v * slice;
            }
            if (Math.abs(value.x - value.to) < 0.05 && Math.abs(value.v) < 1) {
                value.x = value.to;
                value.v = 0;
            }
            else
                moving = true;
        }
        apply(read());
        frame = moving ? requestAnimationFrame(step) : 0;
    };
    return {
        target: () => (values.size ? Object.fromEntries([...values].map(([key, value]) => [key, value.to])) : null),
        set(targets, curves, jump) {
            for (const [key, to] of Object.entries(targets)) {
                const curve = curves[key];
                if (curve === undefined)
                    continue;
                const value = values.get(key);
                const { stiffness: k, damping: c } = curve;
                if (value === undefined || jump)
                    values.set(key, { x: to, v: 0, to, k, c });
                else
                    Object.assign(value, { to, k, c });
            }
            if (jump) {
                cancelAnimationFrame(frame);
                frame = 0;
                apply(read());
                return;
            }
            if (!frame) {
                last = performance.now();
                frame = requestAnimationFrame(step);
            }
        },
        stop: () => cancelAnimationFrame(frame),
    };
}
const CHOSEN = '[aria-pressed="true"],[aria-selected="true"],[aria-current="page"]';
/** How a glide finds its container, its chosen item, and the springs it runs on. */
export interface GlideOptions {
    readonly axis?: 'x' | 'y' | undefined;
    readonly selector?: string | undefined;
    readonly lead?: SpringCurve | undefined;
    readonly trail?: SpringCurve | undefined;
    readonly box?: RefObject<HTMLElement | null> | undefined;
}
/** The container and thumb refs a glide drives. */
export interface Glide {
    readonly box: RefObject<HTMLElement | null>;
    readonly thumb: RefObject<HTMLElement | null>;
}
interface GlideState {
    key: string | undefined;
    node: HTMLElement | null;
    observer: ResizeObserver | null;
    springs: LiveSprings;
}
// One thumb for a row (or column) of choices that glides to the chosen one. Attach
// `box` to the positioned container and `thumb` to an absolutely placed child; the
// thumb appears in place with a new box, then springs on every change of `key`. The
// box gets data-glide once the thumb is placed, so its CSS can drop the chosen item's
// own fill. `selector` finds the chosen item; with none the thumb gets data-hidden.
// `box` takes a ref the caller already holds for the container.
export function useGlide(key: string | undefined, { axis = 'x', selector = CHOSEN, lead = SPRING_LEAD, trail = SPRING_TRAIL, box: given }: GlideOptions = {}): Glide {
    const ownBox = useRef<HTMLElement | null>(null);
    const box = given ?? ownBox;
    const thumb = useRef<HTMLElement | null>(null);
    const own = useRef<GlideState | null>(null);
    if (own.current === null) {
        own.current = {
            key: undefined, node: null, observer: null,
            springs: liveSprings(values => {
                const knob = thumb.current;
                if (!knob)
                    return;
                const start = values['start'] ?? 0;
                const end = values['end'] ?? 0;
                knob.style.transform = axis === 'x' ? `translateX(${start}px)` : `translateY(${start}px)`;
                knob.style[axis === 'x' ? 'width' : 'height'] = `${Math.max(0, end - start)}px`;
            }),
        };
    }
    // `jump` places without motion, and only when the chosen item moved: a box that
    // resizes while the thumb is under way does not cut the glide short.
    const place = (jump: boolean): void => {
        const container = box.current;
        const knob = thumb.current;
        if (!container || !knob)
            return;
        const chosen = container.querySelector<HTMLElement>(selector);
        if (!chosen) {
            knob.dataset.hidden = '';
            return;
        }
        const start = axis === 'x' ? chosen.offsetLeft : chosen.offsetTop;
        const end = start + (axis === 'x' ? chosen.offsetWidth : chosen.offsetHeight);
        const springs = own.current?.springs;
        if (springs === undefined)
            return;
        const before = springs.target();
        const hidden = knob.dataset.hidden !== undefined;
        if (jump && !hidden && before?.['start'] === start && before['end'] === end && container.dataset.glide !== undefined)
            return;
        delete knob.dataset.hidden;
        const forward = before === null || start >= (before['start'] ?? start);
        springs.set({ start, end }, forward ? { start: trail, end: lead } : { start: lead, end: trail }, jump || hidden || before === null || reducedMotion());
        container.dataset.glide = '';
    };
    useLayoutEffect(() => {
        const state = own.current;
        if (state === null)
            return;
        const node = box.current;
        if (node === state.node && key === state.key)
            return;
        const fresh = node !== state.node;
        state.key = key;
        if (fresh) {
            state.observer?.disconnect();
            state.node = node;
            state.observer = node !== null && typeof ResizeObserver === 'function' ? new ResizeObserver(() => place(true)) : null;
            if (state.observer !== null && node !== null)
                state.observer.observe(node);
        }
        place(fresh);
    });
    useEffect(() => () => { own.current?.observer?.disconnect(); own.current?.springs.stop(); }, []);
    return { box, thumb };
}
/** A segmented choice: one pill per value, with the thumb gliding between them. */
export interface SegmentedProps {
    readonly label?: string | undefined;
    readonly value?: string | undefined;
    readonly className?: string | undefined;
    readonly children?: ReactNode;
}
// Buttons side by side over one thumb that glides to the pressed one (aria-pressed).
export function Segmented({ label, value, className, children }: SegmentedProps) {
    const glide = useGlide(value);
    return <div ref={glide.box as Ref<HTMLDivElement>} className={className ? `bt-seg ${className}` : 'bt-seg'} role='group' aria-label={label}><span ref={glide.thumb as Ref<HTMLSpanElement>} className='bt-thumb' aria-hidden/>{children}</div>;
}
export { useFlip, useMorph, useLinger } from './motion-hooks.ts';
