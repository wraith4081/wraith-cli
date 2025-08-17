import { makeEntityArgumentProvider } from '@core/command/entity-providers.js';
import { SimpleAnnouncer } from '../core/a11y/announcer.js';
import { navigateToWithAnnounce } from '../core/a11y/integrations.js';
import {
	CommandRegistry,
	registerDirectPanelCommands,
	registerNavigationCommands,
} from '../core/command/index.js';
import { HotkeyManager } from '../core/hotkeys/registry.js';
import type { Platform } from '../core/hotkeys/types.js';
import type {
	FocusResolver,
	Route,
	RouterAPI,
} from '../core/navigation/types.js';
import { PaletteController } from '../core/palette/controller.js';
import type { PaletteState } from '../core/palette/types.js';
import { PanelRegistry } from '../core/panel/registry.js';
import type { PanelController } from '../core/panel/types.js';
import { initOnLaunch } from '../core/startup/initializer.js';
import type { TuiStore } from './store.js';

type PanelId = 'chat' | 'context' | 'rules' | 'approvals' | 'diffs' | 'status';

const PANEL_ORDER: PanelId[] = [
	'chat',
	'context',
	'rules',
	'approvals',
	'diffs',
	'status',
];

function toPlatform(p: NodeJS.Platform): Platform {
	if (p === 'darwin' || p === 'win32' || p === 'linux') {
		return p;
	}
	// Default to linux behavior if unknown
	return 'linux';
}

function getFocusedRoute(store: TuiStore): Route | undefined {
	const idx = store.get().ui.focusIndex ?? 0;
	return PANEL_ORDER[idx];
}

class TuiRouter implements RouterAPI {
	constructor(
		private readonly store: TuiStore,
		private readonly panels: PanelRegistry
	) {}
	getCurrent(): Route | undefined {
		return getFocusedRoute(this.store);
	}
	exists(route: Route): boolean {
		return PANEL_ORDER.includes(route as PanelId);
	}
	goTo(route: Route): void {
		const idx = PANEL_ORDER.indexOf(route as PanelId);
		if (idx < 0) {
			throw new Error(`Unknown route '${route}'`);
		}
		// ensure open then focus
		try {
			this.panels.open(route);
		} catch {
			// ignore
		}
		this.store.set((s) => ({ ...s, ui: { ...s.ui, focusIndex: idx } }));
	}
}

function makePanelController(id: PanelId, store: TuiStore): PanelController {
	function isOpen(): boolean {
		const open = store.get().ui as any;
		const map = (open.panelsOpen ?? {}) as Record<string, boolean>;
		return map[id] !== false; // default open
	}
	return {
		isOpen,
		open() {
			store.set((s) => ({
				...s,
				ui: {
					...s.ui,
					panelsOpen: { ...s.ui.panelsOpen, [id]: true },
				},
			}));
		},
		close() {
			store.set((s) => ({
				...s,
				ui: {
					...s.ui,
					panelsOpen: { ...(s.ui as any).panelsOpen, [id]: false },
				},
			}));
		},
		toggle() {
			const open = isOpen();
			store.set((s) => ({
				...s,
				ui: {
					...s.ui,
					panelsOpen: { ...(s.ui as any).panelsOpen, [id]: !open },
				},
			}));
		},
		focus() {
			const idx = PANEL_ORDER.indexOf(id);
			if (idx >= 0) {
				store.set((s) => ({ ...s, ui: { ...s.ui, focusIndex: idx } }));
			}
		},
	};
}

// Adapter to make PaletteController observable for React via subscribe/get
class PaletteAdapter {
	private listeners = new Set<() => void>();
	private snapshot: PaletteState;
	constructor(private readonly palette: PaletteController) {
		// Cache initial snapshot to keep getSnapshot referentially stable
		this.snapshot = this.palette.getState();
	}
	getState() {
		// Must return cached reference for useSyncExternalStore stability
		return this.snapshot;
	}
	subscribe(cb: () => void) {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}
	private notify() {
		// Update snapshot just before notifying subscribers about a change
		this.snapshot = this.palette.getState();
		for (const l of this.listeners) l();
	}
	async open() {
		await this.palette.open();
		this.notify();
	}
	close() {
		this.palette.close();
		this.notify();
	}
	async toggle() {
		await this.palette.toggle();
		this.notify();
	}
	async input(text: string) {
		await this.palette.input(text);
		this.notify();
	}
	async setQuery(text: string) {
		await this.palette.setQuery(text);
		this.notify();
	}
	async key(k: 'ArrowUp' | 'ArrowDown' | 'Tab' | 'Enter' | 'Escape') {
		await this.palette.key(k);
		this.notify();
	}
	async execute() {
		await this.palette.execute();
		this.notify();
	}
}

export type TuiIntegration = {
	panels: PanelRegistry;
	commands: CommandRegistry;
	hotkeys: HotkeyManager;
	router: RouterAPI;
	announcer: SimpleAnnouncer;
	palette: PaletteAdapter;
	focus: FocusResolver;
	navigateTo: (route: Route) => void;
};

export function createTuiIntegration(store: TuiStore): TuiIntegration {
	const panels = new PanelRegistry();
	// Register panels and aliases
	panels.register('chat', makePanelController('chat', store));
	panels.register('context', makePanelController('context', store), ['ctx']);
	panels.register('rules', makePanelController('rules', store));
	panels.register('approvals', makePanelController('approvals', store), [
		'tools',
	]);
	panels.register('diffs', makePanelController('diffs', store), ['changes']);
	panels.register('status', makePanelController('status', store));

	const router = new TuiRouter(store, panels);
	const commands = new CommandRegistry();
	const announcer = new SimpleAnnouncer();

	// Entity provider uses panel routes + commands
	const provider = makeEntityArgumentProvider({
		registry: commands,
		routes: () => PANEL_ORDER.slice(),
	});
	const paletteCtl = new PaletteController(
		commands,
		{ persistOnExecute: false },
		provider,
		announcer
	);
	const palette = new PaletteAdapter(paletteCtl);

	// Announcements surface in UI message area
	announcer.on((msg) => {
		store.set((s) => ({ ...s, ui: { ...s.ui, message: msg } }));
	});

	// Commands: register navigation + direct panel commands
	registerNavigationCommands(commands, router);
	registerDirectPanelCommands(commands, panels);

	// Hotkeys
	const hotkeys = new HotkeyManager(toPlatform(process.platform));
	hotkeys.register('palette.toggle', 'Mod+K', async () => {
		await palette.toggle();
	});

	// Focus resolver: map current focused panel to primary-action if any
	const focus: FocusResolver = {
		current() {
			const route = getFocusedRoute(store);
			if (!route) return;
			// Chat: treat Enter as submit when handler exists
			if (route === 'chat') {
				const s = store.get();
				const text = s.chat.input;
				const submit = s.onSubmitChat;
				return {
					kind: 'input',
					inputBehavior: 'submit',
					submit: submit
						? () => Promise.resolve(submit(text))
						: undefined,
				};
			}
			// Provide primary action for diffs: open the first diff
			if (route === 'diffs') {
				const s = store.get();
				const first = s.diffs?.[0];
				const open = s.onOpenDiff;
				if (first && open) {
					return {
						kind: 'primary-action',
						activate: () => Promise.resolve(open(first.title)),
					};
				}
			}
			return { kind: 'non-actionable' };
		},
	};

	return {
		panels,
		commands,
		hotkeys,
		router,
		announcer,
		palette,
		focus,
		navigateTo: (route: Route) =>
			navigateToWithAnnounce(router, route, announcer),
	};
}

export async function initTuiOnLaunch(integration: TuiIntegration) {
	await initOnLaunch(integration.panels, {});
}
