import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { reducedMotion, SPRING_SHAPE, SPRING_LIST } from './motion.tsx';

export function useFlip(list: RefObject<HTMLElement | null>, key: unknown, selector: string, id: (node: Element) => string | undefined = node => (node as HTMLElement).dataset.flip): void {
    const tops = useRef<Map<string | undefined, number> | null>(null);
    useLayoutEffect(() => {
        const container = list.current;
        if (!container)
            return;
        const previous = tops.current;
        const next = new Map<string | undefined, number>();
        const moving = previous !== null && !reducedMotion();
        for (const node of container.querySelectorAll(selector)) {
            const name = id(node);
            const top = (node as HTMLElement).offsetTop;
            next.set(name, top);
            if (!moving || previous === null)
                continue;
            const before = previous.get(name);
            if (before === undefined) {
                node.animate([{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 180, easing: 'ease-out' });
            }
            else if (Math.abs(before - top) > 0.5) {
                node.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], { duration: SPRING_LIST.duration, easing: SPRING_LIST.easing });
            }
        }
        tops.current = next;
    }, [key]);
}
interface MorphState {
    key: unknown;
    height: number | null;
    node: HTMLElement | null;
    observer: ResizeObserver | null;
}
// `box` changes height on SPRING_SHAPE when a change of `key` changes its content, so
// a surface reshapes around what it holds instead of jumping. A change that comes
// mid-morph starts from the height on screen. The box clips its content meanwhile.
// The resting height comes from a ResizeObserver: reading it on every render would lay
// out the page once per render, the panel's whole first frame when it opens.
export function useMorph(box: RefObject<HTMLElement | null>, key: unknown): void {
    const last = useRef<MorphState>({ key, height: null, node: null, observer: null });
    useLayoutEffect(() => {
        const node = box.current;
        const state = last.current;
        if (node !== state.node) {
            state.observer?.disconnect();
            Object.assign(state, { key, height: null, node, observer: null });
            if (!node || typeof ResizeObserver !== 'function')
                return;
            state.observer = new ResizeObserver(([entry]) => {
                if (node.dataset.morph === undefined)
                    state.height = entry?.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
            });
            state.observer.observe(node);
            return;
        }
        if (!node || key === state.key)
            return;
        const running = node.getAnimations().filter(animation => animation.id === 'bt-morph');
        const from = running.length ? node.offsetHeight : state.height;
        for (const animation of running)
            animation.cancel();
        const to = node.offsetHeight;
        Object.assign(state, { key, height: to });
        if (from === null || Math.abs(from - to) < 1 || reducedMotion())
            return;
        node.dataset.morph = '';
        const animation = node.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: SPRING_SHAPE.duration, easing: SPRING_SHAPE.easing, id: 'bt-morph' });
        animation.onfinish = () => { delete node.dataset.morph; };
        animation.oncancel = () => { if (!node.getAnimations().some(other => other.id === 'bt-morph' && other !== animation))
            delete node.dataset.morph; };
    });
    useEffect(() => () => last.current.observer?.disconnect(), []);
}
// The last truthy `value` for `ms` after it turns falsy, so a closing layer can play its
// exit; `leaving` is true meanwhile.
export function useLinger<T>(value: T, ms: number): readonly [
    T,
    boolean
] {
    const [kept, setKept] = useState<T>(value);
    useEffect(() => {
        if (value) {
            setKept(value);
            return undefined;
        }
        const timer = setTimeout(() => setKept(value), reducedMotion() ? 0 : ms);
        return () => clearTimeout(timer);
    }, [value]);
    return [value || kept, !value && Boolean(kept)];
}
