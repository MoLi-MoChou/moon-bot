import { useLayoutEffect } from 'react';
import type { CellActions } from './cells-bubbles.tsx';

export function useShownCards(actions: CellActions, sessionId: string, callIds: readonly string[]): void {
    const key = JSON.stringify(callIds);
    useLayoutEffect(() => {
        const ids: readonly string[] = JSON.parse(key);
        if (ids.length === 0 || !actions.noteCards)
            return undefined;
        actions.noteCards(sessionId, ids, 1);
        return () => actions.noteCards?.(sessionId, ids, -1);
    }, [sessionId, key]);
}
export function groupVerb(tool: string): readonly [
    string,
    string
] {
    switch (tool) {
        case 'update_group': return ['Updated group', "Couldn't update the group"];
        case 'delete_group': return ['Deleted group', "Couldn't delete the group"];
        case 'post_to_group': return ['Posted in', "Couldn't post in the group"];
        default: return ['Created group', "Couldn't create the group"];
    }
}
