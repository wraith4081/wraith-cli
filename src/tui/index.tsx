import { render } from 'ink';
import {
	type StartChatOptions,
	startChatSession,
} from '../core/orchestrator.js';
import App from './App';
import { createTuiController, type TuiController } from './controller';
import { createTuiIntegration, initTuiOnLaunch } from './integration';
import { createTuiStore, type TuiStore } from './store';
import { ThemeProvider } from './theme';
import type { TuiShellProps } from './types';

export function runTuiShellWithControl(
	initial?: TuiShellProps,
	chat?: StartChatOptions
): {
	stop: () => void;
	controller: TuiController;
} {
	// biome-ignore lint/suspicious/noExplicitAny: tbd
	const store = createTuiStore(initial as any);
	const controller = createTuiController(store);
	const integration = createTuiIntegration(store);
	// Ensure chat opens on launch and focus policy is applied
	initTuiOnLaunch(integration);

	// Initialize chat session with provided options or defaults
	setupChatSession(store, controller, chat ?? {});
	const { unmount } = render(
		<ThemeProvider mode="system">
			<App integration={integration} store={store} />
		</ThemeProvider>
	);
	return { stop: () => unmount(), controller };
}

export function runTuiShell(initial?: TuiShellProps): () => void {
	const { stop } = runTuiShellWithControl(initial);
	return stop;
}

export type { TuiController } from './controller';

function setupChatSession(
	store: TuiStore,
	controller: TuiController,
	opts: StartChatOptions
) {
	const session = startChatSession(opts);
	// Set initial status: model/profile
	controller.setStatus({
		model: session.model,
		profile: session.profile,
		state: 'idle',
	});

	// Wire submit handler
	store.set((s) => ({
		...s,
		onSubmitChat: async (text: string) => {
			const trimmed = text?.trim();
			if (!trimmed) return;
			controller.startStream(trimmed);
			// Update chat history (dedupe consecutive identical entries)
			const hist = (store.get().ui.chatHistory ?? []).slice();
			const last = hist[hist.length - 1];
			const nextHist = last === trimmed ? hist : [...hist, trimmed];
			store.set((s2) => ({
				...s2,
				ui: { ...s2.ui, chatHistory: nextHist, chatHistoryIndex: -1 },
				context: { ...s2.context, notices: [] },
			}));
			session.addUser(trimmed);
			try {
				const res = await session.runAssistant((d) =>
					controller.pushDelta(d)
				);
				controller.endStream({
					model: res.model,
					latencyMs: res.timing.elapsedMs,
					promptTokens: res.usage?.promptTokens,
					completionTokens: res.usage?.completionTokens,
					totalTokens: res.usage?.totalTokens,
					message:
						res.notices && res.notices.length
							? res.notices.join(' • ')
							: undefined,
				});
				// Surface notices in context panel
				if (res.notices?.length) {
					store.set((s2) => ({
						...s2,
						context: { ...s2.context, notices: res.notices! },
					}));
				}
			} catch (err) {
				controller.endStream({
					state: 'error',
					message: (err as Error)?.message || 'chat error',
				});
			}
		},
	}));
}

// Convenience entry used by CLI: start TUI with chat options
export function runTui(opts?: StartChatOptions): () => void {
	const { stop } = runTuiShellWithControl(undefined, opts);
	return stop;
}
