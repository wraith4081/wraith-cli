export type TuiStatus = {
	model?: string;
	profile?: string;
	latencyMs?: number;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	state?: 'idle' | 'streaming' | 'done' | 'error';
	message?: string;
};

export type TuiContextItem = {
	label: string;
	detail?: string;
};

export type TuiCitation = {
	label: string; // e.g., "design.md:42-60"
	source?: string; // file/URL
};

export type TuiRuleSection = {
	title: string;
	content: string;
	scope: 'user' | 'project';
};

export type TuiDiffEntry = {
	title: string;
	summary?: string;
};

export type TuiApproval = {
	tool: string;
	desc: string;
	pending?: boolean;
};

export type TuiShellProps = {
	title?: string;
	chat?: {
		input?: string;
		response?: string;
	};
	context?: {
		items?: TuiContextItem[];
		citations?: TuiCitation[];
	};
	rules?: TuiRuleSection[];
	approvals?: TuiApproval[];
	diffs?: TuiDiffEntry[];
	status?: TuiStatus;
};
