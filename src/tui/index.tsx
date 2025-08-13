import { render } from 'ink';
import App from './App';
import { createTuiController, type TuiController } from './controller';
import { createTuiStore } from './store';
import { ThemeProvider } from './theme';
import type { TuiShellProps } from './types';

export function runTuiShellWithControl(initial?: TuiShellProps): {
	stop: () => void;
	controller: TuiController;
} {
	// biome-ignore lint/suspicious/noExplicitAny: tbd
	const store = createTuiStore(initial as any);
	const controller = createTuiController(store);
	const { unmount } = render(
		<ThemeProvider mode="system">
			<App store={store} />
		</ThemeProvider>
	);
	return { stop: () => unmount(), controller };
}

export function runTuiShell(initial?: TuiShellProps): () => void {
	const { stop } = runTuiShellWithControl(initial);
	return stop;
}

export type { TuiController } from './controller';
