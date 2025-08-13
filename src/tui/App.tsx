import { Box, Text, useInput } from 'ink';
import { useSyncExternalStore } from 'react';
import { ApprovalsPanel } from './panels/ApprovalsPanel';
import { ChatStreamPanel } from './panels/ChatStreamPanel';
import { ContextPanel } from './panels/ContextPanel';
import { DiffsPanel } from './panels/DiffsPanel';
import { RulesPanel } from './panels/RulesPanel';
import { StatusPanel } from './panels/StatusPanel';
import type { TuiStore } from './store';

async function copyToClipboard(text: string): Promise<boolean> {
	try {
		// optional dependency
		// eslint-disable-next-line @typescript-eslint/no-var-requires
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

	// keybindings
	useInput(async (input, key) => {
		// quit
		if (input === 'q') {
			process.exit(0);
			return;
		}
		// tab focus
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
		// render mode
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
		// history nav
		if (input === '[') {
			await state.onNavigateHistory?.(-1);
			return;
		}
		if (input === ']') {
			await state.onNavigateHistory?.(1);
			return;
		}
		// approvals
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
		// open diff viewer
		if (input === 'o') {
			const sel = state.diffs[0];
			await state.onOpenDiff?.(sel?.title);
			return;
		}
		// copy last code block
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

	return (
		<Box flexDirection="column" width="100%">
			{/* Title bar */}
			<Box paddingX={1} paddingY={0}>
				<Text bold>{state.title}</Text>
				{state.ui.message ? (
					<Text color="gray"> — {state.ui.message}</Text>
				) : null}
			</Box>

			{/* 2-column layout */}
			<Box width="100%">
				{/* Left column (primary) */}
				<Box flexDirection="column" flexGrow={1} width="60%">
					<ChatStreamPanel
						focused={state.ui.focusIndex === 0}
						input={state.chat.input}
						response={state.chat.response}
						streaming={state.chat.streaming}
					/>
					<ContextPanel
						citations={state.context.citations}
						focused={state.ui.focusIndex === 1}
						items={state.context.items}
					/>
				</Box>

				{/* Right column (secondary stack) */}
				<Box flexDirection="column" width="40%">
					<RulesPanel
						focused={state.ui.focusIndex === 2}
						sections={state.rules}
					/>
					<ApprovalsPanel
						approvals={state.approvals}
						focused={state.ui.focusIndex === 3}
					/>
					<DiffsPanel
						diffs={state.diffs}
						focused={state.ui.focusIndex === 4}
					/>
					<StatusPanel
						focused={state.ui.focusIndex === 5}
						status={state.status}
					/>
				</Box>
			</Box>

			{/* Footer hint */}
			<Box paddingX={1} paddingY={1}>
				<Text color="gray">
					Tab/Shift+Tab: panels • r: render • c: copy code • [ / ]:
					history • y/n: approve/reject • o: open diff • q: quit
				</Text>
			</Box>
		</Box>
	);
}
