import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSessions, loadSession, saveSessionFromAsk } from '@sessions/store';
import { sessionsDir } from '@util/paths';
import { beforeEach, describe, expect, it } from 'vitest';

function mkTmpProject(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-'));
	process.chdir(d);
	return d;
}

describe('Session store', () => {
	beforeEach(() => {
		mkTmpProject();
	});

	it('saves a single-turn ask and can list/load it', () => {
		const p = saveSessionFromAsk({
			name: 'first',
			prompt: 'Hello?',
			answer: 'Hi!',
			model: 'gpt-test',
			profile: 'default',
			usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
		});

		expect(
			p.startsWith(path.join(process.cwd(), '.wraith', 'sessions'))
		).toBeTruthy();
		expect(fs.existsSync(p)).toBeTruthy();
		expect(fs.existsSync(sessionsDir)).toBeTruthy();

		const listed = listSessions();
		expect(listed.length).toBe(1);
		expect(listed[0].name).toBe('first');
		expect(listed[0].model).toBe('gpt-test');
		expect(listed[0].messages).toBe(2);

		const loaded = loadSession('first');
		expect(loaded?.version).toBe(1);
		expect(loaded?.messages[0]?.role).toBe('user');
		expect(loaded?.messages[1]?.role).toBe('assistant');
		expect(loaded?.meta.model).toBe('gpt-test');
	});
});
