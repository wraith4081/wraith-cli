import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeAttachmentSummary } from '@core/context';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function mkTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-sum-'));
}

function write(p: string, text: string) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, text, 'utf8');
}

describe('computeAttachmentSummary', () => {
	let root: string;
	beforeEach(() => {
		root = mkTmp();
	});
	afterEach(() => {
		try {
			fs.rmSync(root, { recursive: true, force: true });
		} catch {
			//
		}
	});

	it('produces a summary for included files and chunks', async () => {
		write(path.join(root, 'src', 'a.ts'), 'export const x=1;');
		write(
			path.join(root, 'src', 'b.md'),
			'# Title\n\nSome text\n```ts\nconst a=1;\n```\n'
		);

		const res = await computeAttachmentSummary({
			rootDir: root,
			dirPaths: ['src'],
			config: {
				version: '1',
				defaults: { ingestion: { ignore: { useGitIgnore: false } } },
			},
		});

		expect(res.totals.filesIncluded).toBeGreaterThan(0);
		expect(res.totals.chunks).toBeGreaterThan(0);
		const combined = res.lines.join('\n');
		expect(combined).toContain('Context summary:');
		expect(combined).toMatch(/Total estimated tokens/);
	});

	it('handles empty inputs gracefully', async () => {
		const res = await computeAttachmentSummary({
			rootDir: root,
			config: { version: '1' },
		});
		// No paths or URLs => minimal totals
		expect(res.totals.tokensTotal).toBe(0);
		expect(res.lines.at(-1)).toMatch(/Total estimated tokens/);
	});
});
