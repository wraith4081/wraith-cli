import fs from 'node:fs';
import path from 'node:path';
import type { ChatUsage } from '@provider/types';
import { getProjectWraithDir } from '@store/config';

type MetricBase = {
	ts: number; // unix ms
	projectDir: string; // project root
};

export type AskMetric = MetricBase & {
	type: 'ask';
	model: string;
	promptChars: number;
	answerChars: number;
	usage?: ChatUsage;
	elapsedMs: number;
	ok: boolean;
	error?: string;
};

export type ToolMetric = MetricBase & {
	type: 'tool';
	name: string;
	elapsedMs: number;
	ok: boolean;
	error?: string;
};

export type ChatTurnMetric = MetricBase & {
	type: 'chatTurn';
	model: string;
	contentChars: number;
	elapsedMs: number;
	aborted: boolean;
};

export type MetricEvent = AskMetric | ToolMetric | ChatTurnMetric;

let enabled = false;
let currentProjectDir = process.cwd();

export function configureAnalytics(opts: {
	enabled?: boolean;
	projectDir?: string;
}) {
	if (typeof opts.enabled === 'boolean') {
		enabled = opts.enabled;
	}
	if (opts.projectDir) {
		currentProjectDir = opts.projectDir;
	}
}

export function isAnalyticsEnabled() {
	return enabled === true;
}

function usageDir(projectDir: string) {
	return path.join(getProjectWraithDir(projectDir), 'usage');
}

function usageFile(projectDir: string) {
	const d = usageDir(projectDir);
	const y = new Date().getUTCFullYear();
	const m = String(new Date().getUTCMonth() + 1).padStart(2, '0');
	return path.join(d, `metrics-${y}-${m}.jsonl`);
}

function ensureDir(p: string) {
	if (!fs.existsSync(p)) {
		fs.mkdirSync(p, { recursive: true });
		if (process.platform !== 'win32') {
			try {
				fs.chmodSync(p, 0o700);
			} catch {
				// ignore
			}
		}
	}
}

export function writeMetric(ev: MetricEvent, projDir?: string) {
	if (!enabled) {
		return;
	}
	const projectDir = projDir ?? currentProjectDir;
	const dir = usageDir(projectDir);
	ensureDir(dir);
	const file = usageFile(projectDir);
	const line = `${JSON.stringify(ev)}\n`;
	fs.appendFileSync(file, line, { encoding: 'utf8' });
}

export function recordAsk(
	ev: Omit<AskMetric, 'type' | 'ts' | 'projectDir'>,
	projDir?: string
) {
	writeMetric({
		type: 'ask',
		ts: Date.now(),
		projectDir: projDir ?? currentProjectDir,
		...ev,
	});
}
export function recordTool(
	ev: Omit<ToolMetric, 'type' | 'ts' | 'projectDir'>,
	projDir?: string
) {
	writeMetric({
		type: 'tool',
		ts: Date.now(),
		projectDir: projDir ?? currentProjectDir,
		...ev,
	});
}
export function recordChatTurn(
	ev: Omit<ChatTurnMetric, 'type' | 'ts' | 'projectDir'>,
	projDir?: string
) {
	writeMetric({
		type: 'chatTurn',
		ts: Date.now(),
		projectDir: projDir ?? currentProjectDir,
		...ev,
	});
}

export function readAllMetrics(projectDir = currentProjectDir): MetricEvent[] {
	const dir = usageDir(projectDir);
	if (!fs.existsSync(dir)) {
		return [];
	}
	// read all metrics-*.jsonl files in dir
	const events: MetricEvent[] = [];
	for (const f of fs.readdirSync(dir)) {
		if (!/^metrics-\d{4}-\d{2}\.jsonl$/.test(f)) {
			continue;
		}
		const p = path.join(dir, f);
		const raw = fs.readFileSync(p, 'utf8');
		for (const line of raw.split('\n')) {
			const s = line.trim();
			if (!s) {
				continue;
			}
			try {
				const ev = JSON.parse(s) as MetricEvent;
				// very light shape check
				if (
					ev &&
					typeof ev === 'object' &&
					typeof (ev as { ts?: unknown }).ts === 'number'
				) {
					events.push(ev);
				}
			} catch {
				// ignore a bad line
			}
		}
	}
	return events;
}

export type Period = 'day' | 'week' | 'project';

function dayKey(ts: number) {
	// YYYY-MM-DD (UTC)
	const d = new Date(ts);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function weekKey(ts: number) {
	// YYYY-Www (UTC, naive week-of-year)
	const d = new Date(ts);
	const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
	const week = Math.floor((ts - yearStart) / (7 * 24 * 3600 * 1000)) + 1;
	return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface UsageSummaryRow {
	key: string; // day/week/project
	asks: number;
	chatTurns: number;
	toolCalls: number;
	errors: number;
	tokensIn: number;
	tokensOut: number;
	tokensTotal: number;
	avgLatencyMs: number | null;
}

export function summarize(
	events: MetricEvent[],
	by: Period = 'day'
): UsageSummaryRow[] {
	const groups = new Map<string, MetricEvent[]>();
	for (const e of events) {
		const k =
			by === 'day'
				? dayKey(e.ts)
				: by === 'week'
					? weekKey(e.ts)
					: e.projectDir;
		const arr = groups.get(k) ?? [];
		arr.push(e);
		groups.set(k, arr);
	}
	const rows: UsageSummaryRow[] = [];
	for (const [key, evs] of groups) {
		let asks = 0,
			chatTurns = 0,
			toolCalls = 0,
			errors = 0;
		let tokensIn = 0,
			tokensOut = 0,
			tokensTotal = 0;
		let latencySum = 0,
			latencyN = 0;
		for (const e of evs) {
			if (e.type === 'ask') {
				asks++;
				const u = e.usage ?? {};
				tokensIn += u.promptTokens ?? 0;
				tokensOut += u.completionTokens ?? 0;
				tokensTotal +=
					u.totalTokens ??
					(u.promptTokens ?? 0) + (u.completionTokens ?? 0);
				latencySum += e.elapsedMs;
				latencyN++;
				if (!e.ok) {
					errors++;
				}
			} else if (e.type === 'chatTurn') {
				chatTurns++;
				latencySum += e.elapsedMs;
				latencyN++;
				if (e.aborted) {
					errors++;
				}
			} else if (e.type === 'tool') {
				toolCalls++;
				if (!e.ok) {
					errors++;
				}
			}
		}
		rows.push({
			key,
			asks,
			chatTurns,
			toolCalls,
			errors,
			tokensIn,
			tokensOut,
			tokensTotal,
			avgLatencyMs: latencyN ? Math.round(latencySum / latencyN) : null,
		});
	}
	rows.sort((a, b) => a.key.localeCompare(b.key));
	return rows;
}
