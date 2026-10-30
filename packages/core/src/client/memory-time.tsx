import { createElement as h, useEffect, useState } from 'react';
import { dateLocale } from './i18n.ts';

export function ago(at: number, now: number): string | null {
    const seconds = Math.max(0, Math.round((now - at) / 1000));
    if (seconds < 60)
        return null;
    const format = new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto' });
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        return format.format(-minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return format.format(-hours, 'hour');
    return format.format(-Math.round(hours / 24), 'day');
}

export function Skeleton({ label }: {
    label?: string | undefined;
}) {
    return <div className='bt-mem-skel' aria-busy>{[0, 1].map(block => <div key={block} className='bt-mem-skel-block'><span className='bt-mem-skel-head'/><span /><span /><span style={{ width: block === 0 ? '62%' : '48%' }}/></div>)}{label ? <div className='bt-mem-skel-label'>{label}</div> : null}</div>;
}

export function useNow(every: number): number {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), every);
        return () => clearInterval(id);
    }, [every]);
    return now;
}
