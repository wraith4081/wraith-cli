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
		notices?: string[];
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
		panelsOpen?: Record<string, boolean>; // per-panel visibility (default: open)
		chatHistory?: string[];
		chatHistoryIndex?: number; // -1 means composing new, otherwise index into chatHistory
	};
	// callbacks (optional)
	onApproveTool?: (tool: string) => void | Promise<void>;
	onRejectTool?: (tool: string) => void | Promise<void>;
	onOpenDiff?: (title?: string) => void | Promise<void>;
	onNavigateHistory?: (dir: -1 | 1) => void | Promise<void>;
	// chat
	onSubmitChat?: (text: string) => void | Promise<void>;
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
			notices: initial?.context?.notices ?? [],
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
			chatHistory: [],
			chatHistoryIndex: -1,
			panelsOpen: {
				chat: true,
				context: false,
				rules: false,
				approvals: false,
				diffs: false,
				status: false,
			},
		},
		onApproveTool: initial?.onApproveTool,
		onRejectTool: initial?.onRejectTool,
		onOpenDiff: initial?.onOpenDiff,
		onNavigateHistory: initial?.onNavigateHistory,
		onSubmitChat: initial?.onSubmitChat,
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
