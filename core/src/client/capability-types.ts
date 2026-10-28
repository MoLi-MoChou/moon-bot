// The shapes the capability settings page and the shared library helpers read. Kept
// apart from the views so the pure grouping logic can be tested without JSX.
export interface Capability {
    name: string;
    kind: string;
    description?: string;
    transport?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    content?: string;
    items?: string[];
    approved?: boolean;
    createdBy?: string | null;
    updatedAt?: number;
}
export interface CapabilityStatus {
    state: string;
    error?: string;
}
export interface CapabilityBot {
    id: string;
    name: string;
    capabilities?: readonly string[];
}
export interface KeyReadiness {
    total: number;
    missing: string[];
}
export type CapabilityHealthState = 'ready' | 'connecting' | 'needs-approval' | 'error' | 'enabled' | 'off';
export interface CapabilityHealth {
    state: CapabilityHealthState;
    /** The Bot whose live connection is in this state. */
    botName?: string;
    error?: string;
    using: readonly CapabilityBot[];
}
export interface CapabilityActions {
    saveCapability: (payload: Record<string, unknown>) => Promise<unknown>;
    deleteCapability: (name: string) => Promise<unknown>;
    approveCapability: (name: string) => Promise<unknown>;
    setBotCapability: (botId: string, name: string, attached: boolean) => Promise<unknown>;
    retryCapability?: (name: string) => Promise<unknown>;
    testCapability?: (payload: Record<string, unknown>) => Promise<{ readonly tools: readonly string[]; readonly ms: number }>;
    openSettings?: (page: string) => void;
}
export type RunWork = (work: Promise<unknown>) => unknown;
