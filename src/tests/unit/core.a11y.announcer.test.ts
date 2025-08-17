import { describe, expect, it } from 'vitest';
import {
	activateFocusedWithAnnounce,
	navigateToWithAnnounce,
	SimpleAnnouncer,
} from '../../core/a11y/index.js';
import { CommandRegistry } from '../../core/command/index.js';
import type { FocusResolver, RouterAPI } from '../../core/navigation/index.js';
import { PaletteController } from '../../core/palette/index.js';

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

describe('Accessibility announcer', () => {
	it('announces suggestions and selection in PaletteController', async () => {
		const reg = new CommandRegistry();
		reg.register({
			id: 'open',
			args: [{ name: 'route', required: true }],
			handler: () => {
				//
			},
		});
		const a11y = new SimpleAnnouncer();
		const pal = new PaletteController(reg, {}, undefined, a11y);
		await pal.open();
		await pal.setQuery('o');
		const msg = a11y.getLast();
		expect(msg?.message).toMatch(/suggestions/);
		await pal.key('ArrowDown');
		const msg2 = a11y.getLast();
		expect(msg2?.message.length).toBeGreaterThan(0);
	});

	it('announces navigation outcomes', () => {
		const a11y = new SimpleAnnouncer();
		const router = makeRouter(['home', 'specs'], 'home');
		navigateToWithAnnounce(router, 'home', a11y);
		expect(a11y.getLast()?.message).toContain('Already');
		navigateToWithAnnounce(router, 'specs', a11y);
		expect(a11y.getLast()?.message).toContain('Navigated');
	});

	it('announces activation outcomes', async () => {
		const a11y = new SimpleAnnouncer();
		const router = makeRouter(['specs'], 'home');
		const f: FocusResolver = {
			current: () => ({ kind: 'actionable', route: 'specs' }),
		};
		await activateFocusedWithAnnounce(f, router, a11y);
		expect(a11y.getLast()?.message).toBe('Activated');
	});
});
