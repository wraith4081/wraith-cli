import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerUsageCommand } from '@cli/commands/usage';
import { configureAnalytics, recordAsk, recordTool } from '@obs/metrics';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmp: string;
const prevCwd = process.cwd();

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-usage-cli-'));
	process.chdir(tmp);
	configureAnalytics({ enabled: true, projectDir: tmp });
	// seed a couple events
	recordAsk(
		{
			model: 'm1',
			promptChars: 3,
			answerChars: 5,
			elapsedMs: 111,
			usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
			ok: true,
		},
		tmp
	);
	recordTool({ name: 'fs.read', elapsedMs: 1, ok: true }, tmp);
});

afterEach(() => {
	process.chdir(prevCwd);
	try {
		fs.rmSync(tmp, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

function runUsageShowJSON(): string {
	const program = new Command();
	registerUsageCommand(program);
	program.exitOverride();
	const spy = vi.spyOn(console, 'log').mockImplementation(() => {
		// ignore
	});
	// With { from: 'user' } pass only the actual user args (no node/script)
	program.parse(['usage', 'show', '--json'], { from: 'user' });
	const calls = spy.mock.calls.slice();
	spy.mockRestore();
	// collect last call arg
	const [arg] = calls.at(-1) ?? [''];
	return String(arg);
}

describe('cli usage show', () => {
	it('prints JSON summary', () => {
		const out = runUsageShowJSON();
		// should be valid JSON with rows
		const parsed = JSON.parse(out) as {
			rows: Record<string, unknown>[];
		};
		expect(Array.isArray(parsed.rows)).toBe(true);
		expect(parsed.rows.length).toBeGreaterThan(0);
		const row = parsed.rows[0];
		expect(typeof row.key).toBe('string');
		expect(row.asks).toBeGreaterThanOrEqual(1);
		expect(row.tokensTotal).toBeGreaterThanOrEqual(5);
	});
});
