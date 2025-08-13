import { render } from 'ink';
import App from './App';
import { createTuiController, type TuiController } from './controller';
import { createTuiStore } from './store';
import type { TuiShellProps } from './types';

export function runTuiShellWithControl(initial?: TuiShellProps): {
	stop: () => void;
	controller: TuiController;
} {
	// biome-ignore lint/suspicious/noExplicitAny: tbd
	const store = createTuiStore(initial as any);
	const controller = createTuiController(store);
	const { unmount } = render(<App store={store} />);
	return { stop: () => unmount(), controller };
}

// Back-compat wrapper returning only a stop function
export function runTuiShell(initial?: TuiShellProps): () => void {
	const { stop } = runTuiShellWithControl(initial);
	return stop;
}

// re-export controller type for consumers
export type { TuiController } from './controller';
