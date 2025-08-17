import { activateFocused, navigateTo } from '../navigation/navigation.js';
import type { FocusResolver, Route, RouterAPI } from '../navigation/types.js';
import type { Announcer } from './announcer.js';

export function navigateToWithAnnounce(
	router: RouterAPI,
	route: Route,
	a11y?: Announcer
) {
	const res = navigateTo(router, route);
	if (a11y) {
		if (res.status === 'ok') {
			a11y.announce(`Navigated to ${route}`, 'polite');
		} else if (res.status === 'already-open') {
			a11y.announce(`Already on ${route}`, 'polite');
		} else {
			a11y.announce(res.message ?? 'Navigation failed', 'assertive');
		}
	}
	return res;
}

export async function activateFocusedWithAnnounce(
	focus: FocusResolver,
	router: RouterAPI,
	a11y?: Announcer
) {
	const res = await activateFocused(focus, router);
	if (a11y) {
		if (res.status === 'activated') {
			a11y.announce('Activated', 'polite');
		} else if (res.status === 'no-op') {
			a11y.announce(res.message ?? 'No action', 'polite');
		} else {
			a11y.announce(res.message ?? 'Activation failed', 'assertive');
		}
	}
	return res;
}
