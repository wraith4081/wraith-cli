import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadUserAndProjectRules } from '@rules/loader';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

function makeTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-rules-'));
}

function writeFile(p: string, data: unknown) {
	const dir = path.dirname(p);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		p,
		p.endsWith('.json')
			? JSON.stringify(data, null, 2)
			: YAML.stringify(data),
		'utf8'
	);
}

describe('Rules loader', () => {
	let userRoot: string;
	let projectRoot: string;

	beforeEach(() => {
		userRoot = makeTmp();
		projectRoot = makeTmp();
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

	it('loads user and project rules from files', () => {
		const userRules = {
			version: '1',
			sections: [{ title: 'Tone', rules: ['Be concise.'] }],
		};
		const projectRules = {
			version: '1',
			sections: [
				{ title: 'Repo', rules: ['Use ESM.', 'Lint with Biome.'] },
			],
		};
		writeFile(path.join(userRoot, '.wraith', 'user-rules.yaml'), userRules);
		writeFile(
			path.join(projectRoot, '.wraith', 'project-rules.yaml'),
			projectRules
		);

		const { userSections, projectSections, errors, truncated } =
			loadUserAndProjectRules({
				userDir: userRoot,
				projectDir: projectRoot,
			});

		expect(errors).toHaveLength(0);
		expect(truncated).toBe(false);
		expect(userSections[0]?.title).toBe('Tone');
		expect(userSections[0]?.rules).toContain('Be concise.');
		expect(projectSections[0]?.title).toBe('Repo');
		expect(projectSections[0]?.rules).toContain('Use ESM.');
	});

	it('summarizes when over size threshold', () => {
		const longRules = {
			version: '1',
			sections: [
				{
					title: 'Big',
					rules: Array.from({ length: 50 }, (_, i) =>
						`Rule ${i} `.repeat(5)
					),
				},
			],
		};
		writeFile(
			path.join(projectRoot, '.wraith', 'project-rules.yaml'),
			longRules
		);

		const { projectSections, truncated, errors } = loadUserAndProjectRules({
			projectDir: projectRoot,
			maxChars: 200, // very small to force truncate
			overLimitBehavior: 'summarize',
		});

		expect(errors).toHaveLength(0);
		expect(truncated).toBe(true);
		const joined = projectSections.flatMap((s) => s.rules).join('\n');
		expect(joined).toMatch(/omitted due to size limits/);
	});

	it('rejects when over size threshold and behavior=reject', () => {
		const longRules = {
			version: '1',
			sections: [
				{
					title: 'Big',
					rules: Array.from({ length: 100 }, (_, i) => `R${i}`),
				},
			],
		};
		writeFile(path.join(userRoot, '.wraith', 'user-rules.yaml'), longRules);

		const { userSections, errors, truncated } = loadUserAndProjectRules({
			userDir: userRoot,
			maxChars: 50,
			overLimitBehavior: 'reject',
		});

		expect(truncated).toBe(false);
		expect(userSections.length).toBe(0);
		expect(
			errors.some(
				(e) => e.scope === 'user' && /exceed size limit/.test(e.message)
			)
		).toBe(true);
	});

	it('reports schema errors precisely', () => {
		const badRules = { sections: [{ title: '', rules: 'not-array' }] }; // invalid title and rules type
		writeFile(
			path.join(projectRoot, '.wraith', 'project-rules.json'),
			badRules
		);

		const { projectSections, errors } = loadUserAndProjectRules({
			projectDir: projectRoot,
		});

		expect(projectSections.length).toBe(0);
		expect(
			errors.some(
				(e) =>
					e.scope === 'project' &&
					e.message === 'Invalid rules schema'
			)
		).toBe(true);
		const issuePaths = errors.flatMap(
			(e) => e.issues?.map((i) => i.path) ?? []
		);
		expect(issuePaths.join(',')).toContain('sections.0.title');
	});
});
