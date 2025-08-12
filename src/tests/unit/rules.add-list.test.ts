import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadUserAndProjectRules, type Ruleset } from '@rules/loader';
import {
	appendRulesToSection,
	loadRulesetForScope,
	type RulesScope,
	saveRulesetForScope,
} from '@rules/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

function mkTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-rules-'));
}

describe('rules storage and listing', () => {
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

	function load(scope: RulesScope) {
		return loadRulesetForScope(scope, {
			userDir: userRoot,
			projectDir: projectRoot,
		});
	}
	function save(
		scope: RulesScope,
		rs: Ruleset,
		fmt: 'yaml' | 'json' = 'yaml'
	) {
		return saveRulesetForScope(scope, rs, {
			userDir: userRoot,
			projectDir: projectRoot,
			format: fmt,
		});
	}

	it('appends rules to project rules and persists YAML with secure perms', () => {
		const initial = {
			version: '1',
			sections: [{ title: 'Project Rules', rules: ['Use ESM.'] }],
		};
		const { path: p1 } = save('project', initial as Ruleset, 'yaml');
		expect(fs.existsSync(p1)).toBe(true);

		const { ruleset } = load('project');
		const updated = appendRulesToSection(ruleset, 'Project Rules', [
			'Prefer Bun.',
			'Lint with Biome.',
		]);
		const { path: p2 } = save('project', updated, 'yaml');
		expect(p2).toBe(p1); // same file

		const text = fs.readFileSync(p2, 'utf8');
		const parsed = YAML.parse(text) as {
			sections: { title: string; rules: string[] }[];
		};
		expect(parsed.sections[0].rules).toContain('Prefer Bun.');
		if (process.platform !== 'win32') {
			const mode = fs.statSync(p2).mode & 0o777;
			expect(mode).toBe(0o600);
		}
	});

	it('creates user rules file when missing and appends under a new section', () => {
		const { ruleset } = load('user');
		const updated = appendRulesToSection(ruleset, 'Tone', ['Be concise.']);
		const { path: p } = save('user', updated, 'yaml');
		expect(fs.existsSync(p)).toBe(true);

		const text = fs.readFileSync(p, 'utf8');
		const parsed = YAML.parse(text) as {
			sections: { title: string; rules: string[] }[];
		};
		expect(parsed.sections[0].title).toBe('Tone');
		expect(parsed.sections[0].rules[0]).toBe('Be concise.');
	});

	it('effective list merges user+project for loader', () => {
		// Create user rules
		const userFile = path.join(userRoot, '.wraith', 'user-rules.yaml');
		fs.mkdirSync(path.dirname(userFile), { recursive: true });
		fs.writeFileSync(
			userFile,
			YAML.stringify({
				version: '1',
				sections: [{ title: 'Tone', rules: ['Be helpful.'] }],
			}),
			'utf8'
		);
		// Create project rules
		const projFile = path.join(
			projectRoot,
			'.wraith',
			'project-rules.yaml'
		);
		fs.mkdirSync(path.dirname(projFile), { recursive: true });
		fs.writeFileSync(
			projFile,
			YAML.stringify({
				version: '1',
				sections: [{ title: 'Repo', rules: ['Use ESM.'] }],
			}),
			'utf8'
		);

		const { userSections, projectSections, errors } =
			loadUserAndProjectRules({
				userDir: userRoot,
				projectDir: projectRoot,
			});
		expect(errors.length).toBe(0);
		expect(userSections[0].title).toBe('Tone');
		expect(projectSections[0].title).toBe('Repo');
	});
});
