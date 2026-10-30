import { createElement as h } from 'react';
import type React from 'react';

export interface FieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    onBlur?: (() => void) | undefined;
    multiline?: boolean | undefined;
    disabled?: boolean | undefined;
    placeholder?: string | undefined;
    error?: string | undefined;
    hint?: string | undefined;
    /** `stack` = settings row (capability form). `compact` = connector secret-field look. */
    layout?: 'stack' | 'compact' | undefined;
}

export function Field({ label, value, onChange, onBlur, multiline = false, disabled = false, placeholder, error, hint, layout = 'stack' }: FieldProps) {
    const field = multiline
        ? <textarea className={error ? 'bt-input bt-input-error' : 'bt-input'} value={value} disabled={disabled} placeholder={placeholder} spellCheck={false} aria-invalid={error !== undefined} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)} onBlur={onBlur} />
        : <input className={error ? 'bt-input bt-input-error' : 'bt-input'} value={value} disabled={disabled} placeholder={placeholder} spellCheck={false} aria-invalid={error !== undefined} onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} onBlur={onBlur} />;
    if (layout === 'compact') {
        return <label className='bt-q-field bt-secret-field'><span className='bt-set-hint'>{label}</span>{field}{hint ? <span className='bt-set-hint'>{hint}</span> : null}{error ? <span className='bt-field-error' role='alert'>{error}</span> : null}</label>;
    }
    return <label className='bt-set-row bt-bs-row bt-bs-stack'><span className='bt-set-copy'><span className='bt-bs-label'>{label}</span>{hint ? <span className='bt-set-hint'>{hint}</span> : null}</span>{field}{error ? <span className='bt-field-error' role='alert'>{error}</span> : null}</label>;
}

export interface SelectProps {
    label: string;
    value: string;
    options: readonly (readonly [string, string])[];
    onChange: (value: string) => void;
}

export function Select({ label, value, options, onChange }: SelectProps) {
    return <label className='bt-set-row bt-bs-row bt-bs-stack'><span className='bt-set-copy'><span className='bt-bs-label'>{label}</span></span><select className='bt-input' value={value} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}
