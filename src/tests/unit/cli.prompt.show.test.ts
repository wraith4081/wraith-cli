import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeEffectivePrompt } from '@cli/commands/prompt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

function mkTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-prompt-'));
}

function writeRulesFile(root: string, name: string, data: unknown) {
	const dir = path.join(root, '.wraith');
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, name);
	const content = file.endsWith('.json')
		? JSON.stringify(data, null, 2)
		: YAML.stringify(data);
	fs.writeFileSync(file, content, 'utf8');
	return file;
}

describe('ai prompt show (computeEffectivePrompt)', () => {
	let userRoot: string;
	let projectRoot: string;

	beforeEach(() => {
		userRoot = mkTmp();
		projectRoot = mkTmp();
	});

	afterEach(() => {
		try {
			fs.rmSync(userRoot, { recursive: true, force: true });
		} catch {
			//
		}
		try {
			fs.rmSync(projectRoot, { recursive: true, force: true });
		} catch {
			//
		}
	});

	it('shows default persona when no rules present', async () => {
		const { prompt, meta } = await computeEffectivePrompt({
			userDir: userRoot,
			projectDir: projectRoot,
			config: { version: '1' },
		});
		expect(prompt).toContain(
			'You are Wraith: a helpful developer CLI assistant.'
		);
		expect(meta.userSectionCount).toBe(0);
		expect(meta.projectSectionCount).toBe(0);
	});

	it('merges user and project rule sections', async () => {
		writeRulesFile(userRoot, 'user-rules.yaml', {
			version: '1',
			sections: [{ title: 'Tone', rules: ['Be concise.'] }],
		});
		writeRulesFile(projectRoot, 'project-rules.yaml', {
			version: '1',
			sections: [{ title: 'Repo', rules: ['Use ESM.'] }],
		});

		const { prompt } = await computeEffectivePrompt({
			userDir: userRoot,
			projectDir: projectRoot,
			config: { version: '1' },
		});

		expect(prompt).toContain('## User Rules');
		expect(prompt).toContain('### Tone');
		expect(prompt).toContain('- Be concise.');

		expect(prompt).toContain('## Project Rules');
		expect(prompt).toContain('### Repo');
		expect(prompt).toContain('- Use ESM.');
	});

	it('applies per-command override (merge mode)', async () => {
		const { prompt } = await computeEffectivePrompt({
			userDir: userRoot,
			projectDir: projectRoot,
			config: { version: '1' },
			systemOverride: { content: 'Focus on performance.', mode: 'merge' },
		});
		expect(prompt).toContain('## Per-Command System Override');
		expect(prompt).toContain('Focus on performance.');
	});

	it('applies per-command override (replace mode)', async () => {
		const { prompt } = await computeEffectivePrompt({
			userDir: userRoot,
			projectDir: projectRoot,
			config: { version: '1' },
			systemOverride: {
				content: 'You are now a strict linter.',
				mode: 'replace',
			},
		});
		// replace returns only the override
		expect(prompt).toBe('You are now a strict linter.');
	});
});
