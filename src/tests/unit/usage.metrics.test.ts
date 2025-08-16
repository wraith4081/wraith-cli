import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	configureAnalytics,
	readAllMetrics,
	recordAsk,
	recordTool,
	summarize,
} from '@obs/metrics';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmp: string;
const prevCwd = process.cwd();

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-usage-'));
	process.chdir(tmp);
});

afterEach(() => {
	process.chdir(prevCwd);
	try {
		fs.rmSync(tmp, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe('local analytics capture', () => {
	it('is disabled by default (no files written)', () => {
		// no configureAnalytics(true)
		recordAsk(
			{
				model: 'x',
				promptChars: 10,
				answerChars: 5,
				elapsedMs: 123,
				ok: true,
			},
			tmp
		);
		const dir = path.join(tmp, '.wraith', 'usage');
		expect(fs.existsSync(dir)).toBe(false);
	});

	it('captures ask + tool and summarizes by day', () => {
		configureAnalytics({ enabled: true, projectDir: tmp });

		recordAsk(
			{
				model: 'alpha',
				promptChars: 12,
				answerChars: 34,
				elapsedMs: 200,
				usage: {
					promptTokens: 20,
					completionTokens: 30,
					totalTokens: 50,
				},
				ok: true,
			},
			tmp
		);

		recordTool({ name: 'fs.read', elapsedMs: 5, ok: true }, tmp);
		recordTool(
			{ name: 'web.fetch', elapsedMs: 7, ok: false, error: 'perm' },
			tmp
		);

		const events = readAllMetrics(tmp);
		expect(events.length).toBeGreaterThanOrEqual(3);

		const rows = summarize(events, 'day');
		expect(rows.length).toBeGreaterThan(0);
		const r = rows.at(-1);
		expect(r?.asks).toBeGreaterThanOrEqual(1);
		expect(r?.toolCalls).toBeGreaterThanOrEqual(2);
		expect(r?.errors).toBeGreaterThanOrEqual(1);
		expect(r?.tokensIn).toBeGreaterThan(0);
		expect(r?.tokensOut).toBeGreaterThan(0);
		expect(r?.tokensTotal).toBe(50);
		expect(
			typeof r?.avgLatencyMs === 'number' || r?.avgLatencyMs === null
		).toBe(true);
	});
});
