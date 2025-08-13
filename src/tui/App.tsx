import { Box, Text, useInput, useStdout } from 'ink';
import { useSyncExternalStore } from 'react';
import { ApprovalsPanel } from './panels/ApprovalsPanel';
import { ChatStreamPanel } from './panels/ChatStreamPanel';
import { ContextPanel } from './panels/ContextPanel';
import { DiffsPanel } from './panels/DiffsPanel';
import { RulesPanel } from './panels/RulesPanel';
import { StatusPanel } from './panels/StatusPanel';
import type { TuiStore } from './store';
import { useTheme, useThemeController } from './theme';

async function copyToClipboard(text: string): Promise<boolean> {
	try {
		const c = require('clipboardy');
		await c.write(text);
		return true;
	} catch {
		return false;
	}
}

function extractLastCodeBlock(s: string): string | null {
	const fences = s.match(/```[\s\S]*?```/g);
	if (!fences || fences.length === 0) {
		return null;
	}
	return fences.at(-1) ?? null;
}

export default function App({ store }: { store: TuiStore }) {
	const state = useSyncExternalStore(store.subscribe, store.get, store.get);
	const { stdout } = useStdout();
	const cols = stdout?.columns ?? 120;
	const isNarrow = cols < 90; // threshold for degraded single-panel layout

	const theme = useTheme();
	const themeCtl = useThemeController();

	// keybindings
	useInput(async (input, key) => {
		if (input === 'q') {
			process.exit(0);
			return;
		}
		if (key.tab) {
			store.set((s) => ({
				...s,
				ui: { ...s.ui, focusIndex: (s.ui.focusIndex + 1) % 6 },
			}));
			return;
		}
		if (key.shift && key.tab) {
			store.set((s) => ({
				...s,
				ui: { ...s.ui, focusIndex: (s.ui.focusIndex + 5) % 6 },
			}));
			return;
		}
		if (input === 'r') {
			store.set((s) => ({
				...s,
				ui: {
					...s.ui,
					renderMode:
						s.ui.renderMode === 'plain' ? 'markdown' : 'plain',
					message:
						s.ui.renderMode === 'plain'
							? 'Render: markdown'
							: 'Render: plain',
				},
			}));
			return;
		}
		if (input === 't') {
			const next =
				(theme.mode === 'system' && 'light') ||
				(theme.mode === 'light' && 'dark') ||
				'system';
			themeCtl.setMode(next);
			store.set((s) => ({
				...s,
				ui: {
					...s.ui,
					themeMode: next,
					colorLevel: theme.colorLevel,
					message: `Theme: ${next}`,
				},
			}));
			return;
		}
		if (input === '[') {
			await state.onNavigateHistory?.(-1);
			return;
		}
		if (input === ']') {
			await state.onNavigateHistory?.(1);
			return;
		}
		if (input === 'y') {
			const first = state.approvals.find((a) => a.pending);
			if (first && state.onApproveTool) {
				await state.onApproveTool(first.tool);
			}
			return;
		}
		if (input === 'n') {
			const first = state.approvals.find((a) => a.pending);
			if (first && state.onRejectTool) {
				await state.onRejectTool(first.tool);
			}
			return;
		}
		if (input === 'o') {
			const sel = state.diffs[0];
			await state.onOpenDiff?.(sel?.title);
			return;
		}
		if (input === 'c') {
			const block = extractLastCodeBlock(state.chat.response);
			if (!block) {
				store.set((s) => ({
					...s,
					ui: { ...s.ui, message: 'No code block' },
				}));
				return;
			}
			const ok = await copyToClipboard(
				block.replace(/^```[\w-]*\n?/, '').replace(/\n```$/, '')
			);
			store.set((s) => ({
				...s,
				ui: {
					...s.ui,
					message: ok ? 'Copied code block' : 'Clipboard unavailable',
				},
			}));
			return;
		}
	});

	// pick which panels to show when narrow
	const focused = state.ui.focusIndex;
	const leftStack = (
		<>
			<ChatStreamPanel
				focused={focused === 0}
				input={state.chat.input}
				response={state.chat.response}
				streaming={state.chat.streaming}
			/>
			<ContextPanel
				citations={state.context.citations}
				focused={focused === 1}
				items={state.context.items}
			/>
		</>
	);
	const rightStack = (
		<>
			<RulesPanel focused={focused === 2} sections={state.rules} />
			<ApprovalsPanel
				approvals={state.approvals}
				focused={focused === 3}
			/>
			<DiffsPanel diffs={state.diffs} focused={focused === 4} />
			<StatusPanel focused={focused === 5} status={state.status} />
		</>
	);

	return (
		<Box flexDirection="column" width="100%">
			{/* Title bar */}
			<Box paddingX={1} paddingY={0}>
				<Text bold>{state.title}</Text>
				<Text color="gray">
					{' '}
					— theme {theme.mode} • colors {theme.colorLevel} • {cols}x
				</Text>
				{state.ui.message ? (
					<Text color="gray"> — {state.ui.message}</Text>
				) : null}
			</Box>

			{isNarrow ? (
				// Degraded single-panel layout: only focused panel + status
				<Box flexDirection="column" width="100%">
					{focused <= 1 ? leftStack : rightStack}
					<StatusPanel focused={false} status={state.status} />
				</Box>
			) : (
				// Two-column layout (default)
				<Box width="100%">
					<Box flexDirection="column" flexGrow={1} width="60%">
						{leftStack}
					</Box>
					<Box flexDirection="column" width="40%">
						{rightStack}
					</Box>
				</Box>
			)}

			{/* Footer hint */}
			<Box paddingX={1} paddingY={1}>
				<Text color="gray">
					Tab/Shift+Tab: panels • r: render • t: theme • c: copy code
					• [ / ]: history • y/n: approve/reject • o: open diff • q:
					quit
				</Text>
			</Box>
		</Box>
	);
}
