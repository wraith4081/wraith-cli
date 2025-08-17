import type {
	ActivationResult,
	FocusResolver,
	NavigateResult,
	Route,
	RouterAPI,
} from './types.js';

export function navigateTo(router: RouterAPI, route: Route): NavigateResult {
	const current = router.getCurrent();
	if (current === route) {
		return { status: 'already-open', route, message: 'Already open' };
	}
	if (!router.exists(route)) {
		return {
			status: 'not-found',
			route,
			message: `Route '${route}' not found`,
		};
	}
	try {
		// Allow sync or async goTo; caller can await if they want
		const res = router.goTo(route);
		if (res && typeof (res as Promise<void>).then === 'function') {
			// best-effort: fire and forget
			(res as Promise<void>).catch(() => {
				//
			});
		}
		return { status: 'ok', route };
	} catch (err) {
		return { status: 'not-found', route, message: (err as Error).message };
	}
}

export async function activateFocused(
	focus: FocusResolver,
	router: RouterAPI
): Promise<ActivationResult> {
	const info = focus.current();
	if (!info) {
		return { status: 'no-op' };
	}

	if (info.kind === 'non-actionable') {
		return { status: 'no-op' };
	}

	if (info.kind === 'primary-action') {
		if (info.activate) {
			try {
				await info.activate();
				return { status: 'activated' };
			} catch (err) {
				return { status: 'error', message: (err as Error).message };
			}
		}
		return { status: 'no-op' };
	}

	if (info.kind === 'input') {
		const mode = info.inputBehavior ?? 'ignore';
		if (mode === 'submit' && info.submit) {
			try {
				await info.submit();
				return { status: 'activated' };
			} catch (err) {
				return { status: 'error', message: (err as Error).message };
			}
		}
		// newline or ignore are UI-level and not handled here
		return { status: 'no-op' };
	}

	// actionable
	if (info.route) {
		const r = navigateTo(router, info.route);
		if (r.status === 'ok') {
			return { status: 'activated' };
		}
		if (r.status === 'already-open') {
			return { status: 'no-op', message: r.message };
		}
		return { status: 'error', message: r.message };
	}
	if (info.activate) {
		try {
			await info.activate();
			return { status: 'activated' };
		} catch (err) {
			return { status: 'error', message: (err as Error).message };
		}
	}
	return { status: 'no-op' };
}
