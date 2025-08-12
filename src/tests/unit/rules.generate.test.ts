import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatResult, IProvider, StreamDelta } from '@provider/types';
import { generateProjectRules, saveProjectRules } from '@rules/generate';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

class SeqMockProvider implements IProvider {
	readonly name = 'openai' as const;
	private index = 0;
	constructor(private responses: string[]) {}
	async listModels() {
		return await Promise.resolve([]);
	}
	async streamChat(
		_req: unknown,
		onDelta: (d: StreamDelta) => void,
		_signal?: AbortSignal
	): Promise<ChatResult> {
		const content = this.responses[this.index] ?? '';
		this.index++;
		// simulate streaming token-by-token
		for (const ch of content) {
			onDelta({ content: ch });
		}
		return await Promise.resolve({ model: 'gpt-5', content });
	}
	async embed(texts: string[]): Promise<number[][]> {
		return await Promise.resolve(texts.map(() => [0]));
	}
}

describe('generateProjectRules', () => {
	it('produces a validated ruleset from JSON output', async () => {
		const json = JSON.stringify({
			version: '1',
			sections: [
				{ title: 'Project Rules', rules: ['Use ESM.', 'Prefer Bun.'] },
			],
		});
		const provider = new SeqMockProvider([json]);
		const rules = await generateProjectRules(
			'A JS project',
			{ provider },
			{ maxChars: 1000 }
		);
		expect(rules.sections[0]?.title).toBe('Project Rules');
		expect(rules.sections[0]?.rules).toContain('Use ESM.');
	});

	it('repairs once when first output is invalid', async () => {
		const bad = 'not json at all';
		const good = JSON.stringify({
			version: '1',
			sections: [{ title: 'Project Rules', rules: ['Rule A', 'Rule B'] }],
		});
		const provider = new SeqMockProvider([bad, good]);
		const rules = await generateProjectRules(
			'Repair test',
			{ provider },
			{ retries: 1 }
		);
		expect(rules.sections[0]?.rules.length).toBeGreaterThan(0);
	});

	it('summarizes when exceeding size threshold', async () => {
		const rules = Array.from(
			{ length: 200 },
			(_, i) => `Rule ${i} ${'x'.repeat(80)}`
		);
		const json = JSON.stringify({
			version: '1',
			sections: [{ title: 'Project Rules', rules }],
		});
		const provider = new SeqMockProvider([json]);
		const res = await generateProjectRules(
			'Big project',
			{ provider },
			{ maxChars: 500, overLimitBehavior: 'summarize' }
		);
		const flat = res.sections.flatMap((s) => s.rules).join('\n');
		expect(flat).toMatch(/omitted due to size limits/);
	});

	it('persists to YAML with secure perms', async () => {
		const json = JSON.stringify({
			version: '1',
			sections: [{ title: 'Project Rules', rules: ['One.'] }],
		});
		const provider = new SeqMockProvider([json]);
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-gen-'));
		try {
			const rules = await generateProjectRules('Persist test', {
				provider,
			});
			const { path: file } = saveProjectRules(rules, {
				projectDir: tmp,
				format: 'yaml',
			});
			expect(fs.existsSync(file)).toBe(true);
			const doc = YAML.parse(fs.readFileSync(file, 'utf8')) as {
				sections: { title: string; rules: string[] }[];
			};
			expect(doc.sections[0].title).toBe('Project Rules');
			if (process.platform !== 'win32') {
				const mode = fs.statSync(file).mode & 0o777;
				expect(mode).toBe(0o600);
			}
		} finally {
			try {
				fs.rmSync(tmp, { recursive: true, force: true });
			} catch {
				//
			}
		}
	});
});
