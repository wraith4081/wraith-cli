import type { ColorLevel, ThemeMode } from './theme';
import type {
	TuiApproval,
	TuiCitation,
	TuiContextItem,
	TuiDiffEntry,
	TuiRuleSection,
	TuiStatus,
} from './types';

export type RenderMode = 'plain' | 'markdown';

export type TuiState = {
	title: string;
	chat: {
		input: string;
		response: string;
		streaming: boolean;
	};
	context: {
		items: TuiContextItem[];
		citations: TuiCitation[];
	};
	rules: TuiRuleSection[];
	approvals: TuiApproval[];
	diffs: TuiDiffEntry[];
	status: TuiStatus;
	ui: {
		renderMode: RenderMode;
		focusIndex: number; // 0 chat, 1 context, 2 rules, 3 approvals, 4 diffs, 5 status
		message?: string;
		themeMode?: ThemeMode;
		colorLevel?: ColorLevel;
	};
	// callbacks (optional)
	onApproveTool?: (tool: string) => void | Promise<void>;
	onRejectTool?: (tool: string) => void | Promise<void>;
	onOpenDiff?: (title?: string) => void | Promise<void>;
	onNavigateHistory?: (dir: -1 | 1) => void | Promise<void>;
};

export type TuiStore = {
	get: () => TuiState;
	set: (fn: (s: TuiState) => TuiState) => void;
	subscribe: (cb: () => void) => () => void;
};

export function createTuiStore(initial?: Partial<TuiState>): TuiStore {
	let state: TuiState = {
		title: initial?.title ?? 'wraith • session',
		chat: {
			input: initial?.chat?.input ?? '',
			response: initial?.chat?.response ?? '',
			streaming: initial?.chat?.streaming ?? false,
		},
		context: {
			items: initial?.context?.items ?? [],
			citations: initial?.context?.citations ?? [],
		},
		rules: initial?.rules ?? [],
		approvals: initial?.approvals ?? [],
		diffs: initial?.diffs ?? [],
		status: initial?.status ?? { state: 'idle' },
		ui: {
			renderMode: 'plain',
			focusIndex: 0,
			message: undefined,
			themeMode: 'system',
			colorLevel: 'basic',
		},
		onApproveTool: initial?.onApproveTool,
		onRejectTool: initial?.onRejectTool,
		onOpenDiff: initial?.onOpenDiff,
		onNavigateHistory: initial?.onNavigateHistory,
	};

	const listeners = new Set<() => void>();
	const get = () => state;
	const set = (fn: (s: TuiState) => TuiState) => {
		state = fn(state);
		for (const l of listeners) {
			l();
		}
	};
	const subscribe = (cb: () => void) => {
		listeners.add(cb);
		return () => {
			listeners.delete(cb);
		};
	};
	return { get, set, subscribe };
}
