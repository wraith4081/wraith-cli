import type { TuiStore } from './store';
import type { ThemeMode } from './theme';
import type {
	TuiCitation,
	TuiContextItem,
	TuiDiffEntry,
	TuiRuleSection,
	TuiStatus,
} from './types';

export type TuiController = {
	// stream
	startStream: (input?: string) => void;
	pushDelta: (delta: string) => void;
	endStream: (status?: Partial<TuiStatus>) => void;
	// state
	setStatus: (s: Partial<TuiStatus>) => void;
	setContext: (items?: TuiContextItem[], citations?: TuiCitation[]) => void;
	setRules: (r: TuiRuleSection[]) => void;
	setDiffs: (d: TuiDiffEntry[]) => void;
	setApprovals: (
		a: { tool: string; desc: string; pending?: boolean }[]
	) => void;
	setTitle: (t: string) => void;
	setRenderMode: (m: 'plain' | 'markdown') => void;
	setThemeMode: (m: ThemeMode) => void;
	message: (m?: string) => void;
};

export function createTuiController(store: TuiStore): TuiController {
	return {
		startStream(input) {
			store.set((s) => ({
				...s,
				chat: {
					input: input ?? s.chat.input,
					response: '',
					streaming: true,
				},
				status: { ...s.status, state: 'streaming' },
				ui: { ...s.ui, message: undefined },
			}));
		},
		pushDelta(delta) {
			if (!delta) {
				return;
			}
			store.set((s) => ({
				...s,
				chat: {
					...s.chat,
					response: s.chat.response + delta,
					streaming: true,
				},
			}));
		},
		endStream(status) {
			store.set((s) => ({
				...s,
				chat: { ...s.chat, streaming: false },
				status: { ...s.status, state: 'done', ...(status ?? {}) },
			}));
		},
		setStatus(partial) {
			store.set((s) => ({ ...s, status: { ...s.status, ...partial } }));
		},
		setContext(items, citations) {
			store.set((s) => ({
				...s,
				context: {
					items: items ?? s.context.items,
					citations: citations ?? s.context.citations,
				},
			}));
		},
		setRules(rules) {
			store.set((s) => ({ ...s, rules }));
		},
		setDiffs(diffs) {
			store.set((s) => ({ ...s, diffs }));
		},
		setApprovals(approvals) {
			store.set((s) => ({ ...s, approvals: approvals.slice() }));
		},
		setTitle(t) {
			store.set((s) => ({ ...s, title: t }));
		},
		setRenderMode(m) {
			store.set((s) => ({ ...s, ui: { ...s.ui, renderMode: m } }));
		},
		setThemeMode(m) {
			store.set((s) => ({ ...s, ui: { ...s.ui, themeMode: m } }));
		},
		message(m) {
			store.set((s) => ({ ...s, ui: { ...s.ui, message: m } }));
		},
	};
}
