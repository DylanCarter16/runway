// Shared with client components; keep this file free of server imports.

export type RunTarget = { kind: 'learn_ics' } | { kind: 'open_data' } | { kind: 'page'; pageId: string } | { kind: 'all' } | { kind: 'calendar' };
