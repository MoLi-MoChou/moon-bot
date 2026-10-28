// The capability form's own shape and rules: every input is text, JSON fields stay text
// until submit, and one function says what is wrong before the host is asked to save.
import type { Capability } from './capability-types.ts';

export interface CapabilityDraft {
    name: string;
    kind: string;
    description: string;
    transport: string;
    command: string;
    argsText: string;
    envText: string;
    url: string;
    headersText: string;
    content: string;
    items: string[];
    originalName?: string;
}
export interface DraftErrors {
    name?: string;
    command?: string;
    url?: string;
    envText?: string;
    headersText?: string;
    content?: string;
}
export const CAPABILITY_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export type CapabilityTransport = 'stdio' | 'streamable-http' | 'sse';

export const blankCapability = (): CapabilityDraft => ({
    name: '', kind: 'mcp', description: '', transport: 'stdio', command: '',
    argsText: '', envText: '{}', url: '', headersText: '{}', content: '', items: [],
});

export const draftFromCapability = (item: Capability): CapabilityDraft => ({
    ...blankCapability(),
    ...(item as Partial<CapabilityDraft>),
    originalName: item.name,
    argsText: (item.args ?? []).join('\n'),
    envText: JSON.stringify(item.env ?? {}, null, 2),
    headersText: JSON.stringify(item.headers ?? {}, null, 2),
    items: [...(item.items ?? [])],
});

export const transportOf = (draft: CapabilityDraft): CapabilityTransport =>
    draft.transport === 'streamable-http' || draft.transport === 'sse' ? draft.transport : 'stdio';

const jsonObject = (text: string): boolean => {
    try {
        const value = JSON.parse(text || '{}') as unknown;
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }
    catch {
        return false;
    }
};

/** What blocks a save, in the fields themselves; empty means the form may submit. */
export function draftErrors(draft: CapabilityDraft, items: readonly Capability[] = []): DraftErrors {
    const errors: DraftErrors = {};
    const name = draft.name.trim();
    if (name === '')
        errors.name = 'Enter a name.';
    else if (name === 'github')
        errors.name = '"github" is reserved for the GitHub connector.';
    else if (!CAPABILITY_NAME.test(name) || name.length > 32)
        errors.name = 'Use lowercase letters, digits, and single hyphens, starting with a letter.';
    else if (items.some(item => item.name === name && item.name !== draft.originalName))
        errors.name = 'A capability with this name already exists.';
    if (draft.kind === 'mcp') {
        if (transportOf(draft) === 'stdio') {
            if (draft.command.trim() === '')
                errors.command = 'Enter the command that starts the server.';
            if (!jsonObject(draft.envText))
                errors.envText = 'Use a JSON object, such as {"API_KEY": "$MOON_BOT_SECRET_MY_KEY"}.';
        }
        else {
            try {
                const url = new URL(draft.url.trim());
                if (url.protocol !== 'https:' && url.protocol !== 'http:')
                    throw new Error('protocol');
            }
            catch {
                errors.url = 'Enter a full HTTP or HTTPS URL.';
            }
            if (!jsonObject(draft.headersText))
                errors.headersText = 'Use a JSON object, such as {"Authorization": "Bearer $MOON_BOT_SECRET_MY_KEY"}.';
        }
    }
    if (draft.kind === 'skill' && draft.content.trim() === '')
        errors.content = 'Write the skill instructions.';
    return errors;
}

const parseMap = (text: string): Record<string, unknown> => {
    const value = JSON.parse(text || '{}') as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

/** The request `capability-save` takes; callers check `draftErrors` first. */
export function payloadOf(draft: CapabilityDraft): Record<string, unknown> {
    const payload: Record<string, unknown> = { name: draft.name.trim(), kind: draft.kind, description: draft.description };
    if (draft.kind === 'mcp') {
        const transport = transportOf(draft);
        payload.transport = transport;
        if (transport === 'stdio') {
            payload.command = draft.command.trim();
            payload.args = draft.argsText.split('\n').filter(line => line !== '');
            payload.env = parseMap(draft.envText);
        }
        else {
            payload.url = draft.url.trim();
            payload.headers = parseMap(draft.headersText);
        }
    }
    else if (draft.kind === 'skill')
        payload.content = draft.content;
    else
        payload.items = [...draft.items];
    return payload;
}
