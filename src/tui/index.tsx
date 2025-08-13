import { render } from 'ink';
import App from './App';
import type { TuiShellProps } from './types';

export function runTuiShell(props: TuiShellProps = {}): () => void {
	const { unmount } = render(<App {...props} />);
	return () => unmount();
}
