import type { PanelRegistry } from '../panel/registry.js';

export interface StartupOptions {
	deepLinkTarget?: string;
}

export async function initOnLaunch(
	panels: PanelRegistry,
	opts: StartupOptions = {}
): Promise<void> {
	// Always ensure chat panel is opened; never overridden by settings/state.
	try {
		await panels.open('chat');
	} catch {
		// Non-blocking: if chat is unavailable or errors, continue startup.
	}

	// Focus policy: focus chat unless a deep link/explicit intent exists.
	if (!opts.deepLinkTarget) {
		try {
			await panels.focus('chat');
		} catch {
			// ignore if chat missing
		}
	}
}
