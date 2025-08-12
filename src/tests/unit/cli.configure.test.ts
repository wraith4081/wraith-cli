import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runConfigure } from '@cli/commands/configure';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

function makeTmpDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-test-'));
	return dir;
}

describe('ai configure (non-interactive)', () => {
	const origCwd = process.cwd();
	let tmp: string;

	beforeEach(() => {
		tmp = makeTmpDir();
		process.chdir(tmp);
	});

	afterEach(() => {
		process.chdir(origCwd);
		try {
			fs.rmSync(tmp, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	it('writes project config with secure perms and defaults', async () => {
		await runConfigure({ yes: true, scope: 'project', format: 'yaml' });

		const configPath = path.join(tmp, '.wraith', 'config.yaml');
		expect(fs.existsSync(configPath)).toBe(true);

		const content = fs.readFileSync(configPath, 'utf8');
		const cfg = YAML.parse(content) as Record<string, unknown>;
		expect(cfg.version).toBe('1');

		// Basic defaults presence
		const defaults = (cfg.defaults ?? {}) as Record<string, unknown>;
		expect(defaults.profile).toBeTypeOf('string');
		expect(defaults.model).toBeTypeOf('string');
		expect(defaults.rag).toBeTypeOf('object');

		if (process.platform !== 'win32') {
			const mode = fs.statSync(configPath).mode & 0o777;
			expect(mode).toBe(0o600);
		}
	});
});
