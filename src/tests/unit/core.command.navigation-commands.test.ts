import { describe, expect, it } from 'vitest';
import {
	CommandRegistry,
	registerNavigationCommands,
} from '../../core/command/index.js';
import type { RouterAPI } from '../../core/navigation/index.js';

function makeRouter(existing: string[], current?: string): RouterAPI {
	let cur = current;
	return {
		getCurrent: () => cur,
		exists: (r) => existing.includes(r),
		goTo: (r) => {
			cur = r;
		},
	};
}

describe('Navigation commands', () => {
	it('open navigates to known route and is idempotent when already open', async () => {
		const router = makeRouter(['home', 'specs'], 'home');
		const reg = new CommandRegistry();
		registerNavigationCommands(reg, router);

		const r1 = await reg.execute('open', ['specs'], {});
		expect(r1).toBe('ok');
		expect(router.getCurrent()).toBe('specs');
		const r2 = await reg.execute('goto', ['specs'], {});
		expect(r2).toBe('already open');
	});

	it('open errors for unknown route', async () => {
		const router = makeRouter(['home'], 'home');
		const reg = new CommandRegistry();
		registerNavigationCommands(reg, router);
		await expect(reg.execute('open', ['missing'], {})).rejects.toThrow();
	});

	it('help lists commands and shows details for a command', async () => {
		const router = makeRouter(['home'], 'home');
		const reg = new CommandRegistry();
		registerNavigationCommands(reg, router);
		const all = await reg.execute('help', [], {});
		expect(String(all)).toContain('/open');
		const one = await reg.execute('help', ['open'], {});
		expect(String(one)).toContain('/open <route>');
	});
});
