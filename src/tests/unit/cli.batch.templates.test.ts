import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/orchestrator', () => ({
	runAsk: vi.fn(async ({ prompt }: { prompt: string }) => ({
		answer: `[ANS] ${prompt}`,
		model: 'mock',
		timing: { startedAt: 0, elapsedMs: 0 },
	})),
}));

// mock the template util surface (we only care about the render behavior)
vi.mock('@util/templates', () => {
	const meta = { name: 'greet', scope: 'project', path: '/dev/null' };
	return {
		resolveTemplateByName: vi.fn((name: string) =>
			name === 'greet' ? meta : null
		),
		loadTemplateContent: vi.fn(() => 'ignored'),
		renderTemplate: vi.fn((_raw: string, vars: Record<string, string>) => {
			// produce a greeting if `name` is present
			if (!vars.name) {
				return { output: '', missing: ['name'] };
			}
			return { output: `Hello, ${vars.name}!`, missing: [] as string[] };
		}),
	};
});

import { handleBatchCommand } from '@cli/commands/batch';
import { runAsk } from '@core/orchestrator';

function tmpFile(name: string, content: string): string {
	const p = path.join(os.tmpdir(), `batch-tpl-${Date.now()}-${name}`);
	fs.writeFileSync(p, content, 'utf8');
	return p;
}

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: tbd
	(runAsk as any).mockClear?.();
});

describe('cli/batch with templates', () => {
	it('renders CSV rows with a template (no prompt column required)', async () => {
		const f = tmpFile('names.csv', 'name\nAlice\nBob\n');
		const code = await handleBatchCommand({
			filePath: f,
			format: 'csv',
			template: 'greet',
		});
		expect(code).toBe(0);
		// Two answers, separated by a blank line
		// We can’t capture stdout easily here; instead assert runAsk calls:
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		const calls = (runAsk as any).mock.calls;
		expect(calls.length).toBe(2);
		expect(calls[0][0].prompt).toBe('Hello, Alice!');
		expect(calls[1][0].prompt).toBe('Hello, Bob!');
	});

	it('applies --vars defaults when row lacks a variable', async () => {
		const f = tmpFile('single.csv', 'x\n1\n');
		const code = await handleBatchCommand({
			filePath: f,
			format: 'csv',
			template: 'greet',
			vars: { name: 'Zed' },
		});
		expect(code).toBe(0);
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		const calls = (runAsk as any).mock.calls;
		expect(calls.length).toBe(1);
		expect(calls[0][0].prompt).toBe('Hello, Zed!');
	});

	it('reports missing vars as item failures and honors --fail-fast', async () => {
		const f = tmpFile('rows.csv', 'name\n\n\n'); // 2 empty names
		const code = await handleBatchCommand({
			filePath: f,
			format: 'csv',
			template: 'greet',
			failFast: true,
		});
		expect(code).toBe(1);
		// runAsk never called due to missing var on first row
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		const calls = (runAsk as any).mock.calls;
		expect(calls.length).toBe(0);
	});

	it('works with JSONL records using template', async () => {
		const f = tmpFile('data.jsonl', '{"name":"Neo"}\n{"name":"Trinity"}\n');
		const code = await handleBatchCommand({
			filePath: f,
			format: 'jsonl',
			template: 'greet',
		});
		expect(code).toBe(0);
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		const calls = (runAsk as any).mock.calls;
		expect(calls.length).toBe(2);
		expect(calls[0][0].prompt).toBe('Hello, Neo!');
		expect(calls[1][0].prompt).toBe('Hello, Trinity!');
	});
});
