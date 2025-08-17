import { describe, expect, it, vi } from 'vitest';
import {
	activateFocused,
	type FocusResolver,
	navigateTo,
	type RouterAPI,
} from '../../core/navigation/index.js';

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

describe('Navigation', () => {
	it('navigateTo returns already-open when route is current', () => {
		const router = makeRouter(['home', 'specs'], 'home');
		const res = navigateTo(router, 'home');
		expect(res.status).toBe('already-open');
	});

	it('navigateTo errors for unknown route and does not change current', () => {
		const router = makeRouter(['home'], 'home');
		const res = navigateTo(router, 'missing');
		expect(res.status).toBe('not-found');
		expect(router.getCurrent()).toBe('home');
	});

	it('activateFocused triggers navigation for actionable with route', async () => {
		const router = makeRouter(['specs'], 'home');
		const focus: FocusResolver = {
			current: () => ({ kind: 'actionable', route: 'specs' }),
		};
		const res = await activateFocused(focus, router);
		expect(res.status).toBe('activated');
		expect(router.getCurrent()).toBe('specs');
	});

	it('activateFocused no-ops for non-actionable', async () => {
		const router = makeRouter(['home'], 'home');
		const focus: FocusResolver = {
			current: () => ({ kind: 'non-actionable' }),
		};
		const res = await activateFocused(focus, router);
		expect(res.status).toBe('no-op');
	});

	it('input behavior submit calls submit; newline/ignore no-ops', async () => {
		const router = makeRouter(['home'], 'home');
		const submit = vi.fn(async () => {
			//
		});
		const focusSubmit: FocusResolver = {
			current: () => ({ kind: 'input', inputBehavior: 'submit', submit }),
		};
		const focusNewline: FocusResolver = {
			current: () => ({ kind: 'input', inputBehavior: 'newline' }),
		};
		const r1 = await activateFocused(focusSubmit, router);
		expect(r1.status).toBe('activated');
		expect(submit).toHaveBeenCalledTimes(1);
		const r2 = await activateFocused(focusNewline, router);
		expect(r2.status).toBe('no-op');
	});
});
