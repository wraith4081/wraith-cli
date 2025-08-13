import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// SUT
import {
	formatAskJsonErr,
	formatAskJsonOk,
	handleAskCommand,
} from '@cli/commands/ask';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from 'vitest';

// Mocks
vi.mock('@core/orchestrator', () => {
	return {
		runAsk: vi.fn(),
	};
});
vi.mock('@core/structured', () => {
	return {
		runAskStructured: vi.fn(),
	};
});

const { runAsk } = await import('@core/orchestrator');
const { runAskStructured } = await import('@core/structured');

function spyStdout() {
	const spy = vi
		.spyOn(process.stdout, 'write')
		.mockImplementation(() => true);
	return spy;
}
function spyStderr() {
	const spy = vi
		.spyOn(process.stderr, 'write')
		.mockImplementation(() => true);
	return spy;
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('ask CLI – helpers', () => {
	it('formatAskJsonOk / formatAskJsonErr shape', () => {
		const ok = formatAskJsonOk({
			answer: 'Hello',
			model: 'test-model',
			timing: { startedAt: 123, elapsedMs: 5 },
		});
		expect(ok.ok).toBe(true);
		expect(ok.answer).toBe('Hello');
		expect(ok.model).toBe('test-model');

		const startedAt = Date.now() - 1;
		const errOut = formatAskJsonErr(new Error('boom'), startedAt);
		expect(errOut.ok).toBe(false);
		expect(errOut.error.message).toContain('boom');
		expect(errOut.timing.startedAt).toBeTypeOf('number');
	});
});

describe('ask CLI – non-structured', () => {
	it('streams only in markdown mode; non-markdown renders once (no streaming)', async () => {
		(runAsk as unknown as Mock).mockImplementation(
			async (_opts: unknown, _deps: unknown) => {
				// If streaming were enabled we'd get an onDelta here.
				// For 'plain' render it must be disabled.
				return await Promise.resolve({
					answer: 'Hi there',
					model: 'm',
					timing: { startedAt: 1, elapsedMs: 1 },
				});
			}
		);

		const out = spyStdout();
		const err = spyStderr();

		const code = await handleAskCommand({
			prompt: 'hello',
			render: 'plain', // disables streaming path
			stream: true, // ignored by render != markdown
		});
		expect(code).toBe(0);

		const printed = out.mock.calls.map((c) => String(c[0])).join('');
		expect(printed).toContain('Hi there');
		// exactly one final print (plus newline)
		expect(printed.endsWith('\n')).toBe(true);

		// no meta by default
		const errPrinted = err.mock.calls.map((c) => String(c[0])).join('');
		expect(errPrinted).not.toContain('[meta]');
	});

	it('markdown mode streams with onDelta', async () => {
		(runAsk as unknown as Mock).mockImplementation(
			async (_opts: unknown, deps: { onDelta?: (s: string) => void }) => {
				// Simulate streaming
				deps.onDelta?.('A');
				deps.onDelta?.('B');
				return await Promise.resolve({
					answer: 'AB',
					model: 'm',
					timing: { startedAt: 1, elapsedMs: 1 },
				});
			}
		);

		const out = spyStdout();

		const code = await handleAskCommand({
			prompt: 'stream it',
			render: 'markdown',
			stream: true,
		});
		expect(code).toBe(0);

		const printed = out.mock.calls.map((c) => String(c[0])).join('');
		// Stream body + trailing newline we add
		expect(printed).toBe('AB\n');
	});

	it('prints meta when --meta is set (non-JSON path)', async () => {
		(runAsk as unknown as Mock).mockResolvedValue({
			answer: 'ok',
			model: 'm-1',
			timing: { startedAt: 1, elapsedMs: 42 },
		});

		const err = spyStderr();

		const code = await handleAskCommand({
			prompt: 'x',
			render: 'plain',
			meta: true,
		});
		expect(code).toBe(0);

		const meta = err.mock.calls.map((c) => String(c[0])).join('');
		expect(meta).toContain('[meta]');
		expect(meta).toContain('model=m-1');
		expect(meta).toMatch(/elapsed=\d+ms/);
	});

	it('supports --file prompt source', async () => {
		// Prepare a temp file
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-file-'));
		const promptPath = path.join(dir, 'p.txt');
		fs.writeFileSync(promptPath, 'From file', 'utf8');

		let receivedPrompt = '';
		(runAsk as unknown as Mock).mockImplementation(
			async (opts: { prompt: string }) => {
				receivedPrompt = opts.prompt;
				return await Promise.resolve({
					answer: 'ok',
					model: 'm',
					timing: { startedAt: 1, elapsedMs: 1 },
				});
			}
		);

		const code = await handleAskCommand({
			prompt: 'ignored',
			filePath: promptPath,
			render: 'plain',
		});
		expect(code).toBe(0);
		expect(receivedPrompt).toBe('From file');
	});
});

describe('ask CLI – structured JSON mode', () => {
	it('passes attempts; repair maps to attempts=3', async () => {
		(runAskStructured as unknown as Mock).mockResolvedValue({
			ok: true,
			data: { x: 1 },
			text: '{}',
			timing: { startedAt: 1, elapsedMs: 2 },
		});

		const out = spyStdout();

		// Attempt override (4)
		await handleAskCommand({
			prompt: 'shape this',
			output: 'json',
			schemaPath: path.join(__dirname, 'schema.json'),
			attempts: 4,
		});
		expect((runAskStructured as Mock).mock.calls[0][0].maxAttempts).toBe(4);

		// Repair shorthand (≈3)
		await handleAskCommand({
			prompt: 'shape this',
			output: 'json',
			schemaPath: path.join(__dirname, 'schema.json'),
			repair: true,
		});
		expect((runAskStructured as Mock).mock.calls[1][0].maxAttempts).toBe(3);

		// Success prints validated JSON each time; assert the LAST line
		const lines = out.mock.calls
			.map((c) => String(c[0]).trim())
			.filter(Boolean);
		expect(lines.at(-1)).toBe('{"x":1}');
	});

	it('on structured validation failure returns error envelope', async () => {
		(runAskStructured as unknown as Mock).mockResolvedValue({
			ok: false,
			errors: [{ message: 'bad', path: '/a' }],
			text: 'raw',
			timing: { startedAt: 1, elapsedMs: 2 },
		});

		const out = spyStdout();

		const code = await handleAskCommand({
			prompt: 'shape this',
			output: 'json',
			schemaPath: path.join(__dirname, 'schema.json'),
		});
		expect(code).toBe(1);
		const printed = out.mock.calls.map((c) => String(c[0])).join('');
		const obj = JSON.parse(printed) as {
			ok: boolean;
			error: { message: string; errors: unknown[] };
			text: string;
		};
		expect(obj.ok).toBe(false);
		expect(obj.error.message).toContain('Schema validation failed');
		expect(obj.text).toBe('raw');
	});
});
