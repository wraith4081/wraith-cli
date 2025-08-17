import { Box, Text, useInput, useStdout } from 'ink';
import { useSyncExternalStore } from 'react';
import { activateFocusedWithAnnounce } from '../core/a11y/integrations.js';
import type { TuiIntegration } from './integration';
import { ApprovalsPanel } from './panels/approvals-panel';
import { ChatStreamPanel } from './panels/chat-stream-panel';
import { ContextPanel } from './panels/context-panel';
import { DiffsPanel } from './panels/diffs-panel';
import { RulesPanel } from './panels/rules-panel';
import { StatusPanel } from './panels/status-panel';
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

export default function App({
	store,
	integration,
}: {
	store: TuiStore;
	integration?: TuiIntegration;
}) {
	const state = useSyncExternalStore(store.subscribe, store.get, store.get);
	const { stdout } = useStdout();
	const cols = stdout?.columns ?? 120;
	const isNarrow = cols < 90; // threshold for degraded single-panel layout

	const theme = useTheme();
	const themeCtl = useThemeController();

	// Palette state (via adapter) for rendering and input routing
	const paletteState = integration
		? // biome-ignore lint/correctness/useHookAtTopLevel: tbd
			useSyncExternalStore(
				integration.palette.subscribe.bind(integration.palette),
				integration.palette.getState.bind(integration.palette),
				integration.palette.getState.bind(integration.palette)
			)
		: { open: false, query: '', suggestions: [], selected: -1 };

	// keybindings and palette routing
	useInput(async (input, key) => {
		// When palette is open, route navigation and typing to it
		if (integration && paletteState.open) {
			if (key.return) {
				await integration.palette.key('Enter');
				return;
			}
			if (key.escape) {
				await integration.palette.key('Escape');
				return;
			}
			if (key.tab) {
				await integration.palette.key('Tab');
				return;
			}
			if (key.upArrow) {
				await integration.palette.key('ArrowUp');
				return;
			}
			if (key.downArrow) {
				await integration.palette.key('ArrowDown');
				return;
			}
			// Backspace handling: drop last character
			if (key.backspace || (key.delete && key.ctrl)) {
				await integration.palette.setQuery(
					paletteState.query.slice(0, -1)
				);
				return;
			}
			// Accept printable characters and space
			if (input && input.length === 1) {
				await integration.palette.input(input);
				return;
			}
			return;
		}

		// Global hotkeys (e.g., Mod+K for palette)
		if (integration) {
			const handled = await integration.hotkeys.handle({
				key: input,
				ctrlKey: key.ctrl,
				// biome-ignore lint/suspicious/noExplicitAny: tbd
				altKey: (key as any)?.alt,
				shiftKey: key.shift,
				metaKey: key.meta,
			});
			if (handled) {
				return;
			}
		}

		// Slash opens palette with a leading '/'
		if (integration && input === '/') {
			await integration.palette.open();
			await integration.palette.setQuery('/');
			return;
		}

		// History navigation
		if (input === '[') {
			await state.onNavigateHistory?.(-1);
			return;
		}
		if (input === ']') {
			await state.onNavigateHistory?.(1);
			return;
		}

		// Chat-first input when chat is focused: type to compose, Enter to send
		if (state.ui.focusIndex === 0) {
			if (key.return) {
				const text = state.chat.input;
				if (text && state.onSubmitChat) {
					await state.onSubmitChat(text);
					// Clear the input after submitting
					store.set((s) => ({
						...s,
						chat: { ...s.chat, input: '' },
					}));
				} else {
					store.set((s) => ({
						...s,
						ui: { ...s.ui, message: 'No chat handler' },
					}));
				}
				return;
			}
			// Recall chat history with Up/Down arrows
			if (key.upArrow) {
				const hist = state.ui.chatHistory ?? [];
				if (hist.length > 0) {
					const cur = state.ui.chatHistoryIndex ?? -1;
					const next =
						cur === -1 ? hist.length - 1 : Math.max(0, cur - 1);
					store.set((s) => ({
						...s,
						ui: { ...s.ui, chatHistoryIndex: next },
						chat: {
							...s.chat,
							input:
								(s.ui.chatHistory ?? [])[next] ?? s.chat.input,
						},
					}));
				}
				return;
			}
			if (key.downArrow) {
				const hist = state.ui.chatHistory ?? [];
				if (hist.length > 0) {
					const cur = state.ui.chatHistoryIndex ?? -1;
					const next =
						cur < 0 ? -1 : Math.min(hist.length - 1, cur + 1);
					if (next === hist.length - 1 && cur === hist.length - 1) {
						// stay at last
					} else if (next === -1) {
						store.set((s) => ({
							...s,
							ui: { ...s.ui, chatHistoryIndex: -1 },
							chat: { ...s.chat, input: '' },
						}));
					} else {
						store.set((s) => ({
							...s,
							ui: { ...s.ui, chatHistoryIndex: next },
							chat: {
								...s.chat,
								input:
									(s.ui.chatHistory ?? [])[next] ??
									s.chat.input,
							},
						}));
					}
				}
				return;
			}
			if (key.backspace) {
				store.set((s) => ({
					...s,
					chat: { ...s.chat, input: s.chat.input.slice(0, -1) },
				}));
				return;
			}
			if (
				// biome-ignore lint/suspicious/noExplicitAny: tbd
				!(key.ctrl || key.meta || (key as any)?.alt) &&
				input &&
				input.length === 1
			) {
				store.set((s) => ({
					...s,
					chat: { ...s.chat, input: s.chat.input + input },
				}));
				return;
			}
		}

		// Enter activates focused actionable element/page (non-chat)
		if (integration && key.return && state.ui.focusIndex !== 0) {
			await activateFocusedWithAnnounce(
				integration.focus,
				integration.router,
				integration.announcer
			);
			return;
		}

		if (input === 'q') {
			process.exit(0);
			return;
		}
		// Focus navigation: Tab/Shift+Tab cycle through OPEN panels only
		const openOrder: number[] = [0, 1, 2, 3, 4, 5].filter((idx) => {
			switch (idx) {
				case 0:
					return isPanelOpen('chat');
				case 1:
					return isPanelOpen('context');
				case 2:
					return isPanelOpen('rules');
				case 3:
					return isPanelOpen('approvals');
				case 4:
					return isPanelOpen('diffs');
				case 5:
					return isPanelOpen('status');
				default:
					return false;
			}
		});
		const cycleFocus = (direction: 1 | -1) => {
			const cur = state.ui.focusIndex;
			const idxIn = openOrder.indexOf(cur);
			const pos = idxIn === -1 ? 0 : idxIn;
			const nextPos =
				(pos + (direction === 1 ? 1 : openOrder.length - 1)) %
				Math.max(1, openOrder.length);
			const nextIdx = openOrder.length ? openOrder[nextPos] : 0;
			store.set((s) => ({ ...s, ui: { ...s.ui, focusIndex: nextIdx } }));
		};
		if (key.tab && !key.shift) {
			cycleFocus(1);
			return;
		}
		if (key.shift && key.tab) {
			cycleFocus(-1);
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
	function isPanelOpen(
		id: 'chat' | 'context' | 'rules' | 'approvals' | 'diffs' | 'status'
	): boolean {
		const map = state.ui.panelsOpen as Record<string, boolean> | undefined;
		return map?.[id] !== false; // default open
	}

	const leftStack = (
		<>
			{isPanelOpen('chat') ? (
				<ChatStreamPanel
					focused={focused === 0}
					input={state.chat.input}
					response={state.chat.response}
					streaming={state.chat.streaming}
				/>
			) : null}
			{isPanelOpen('context') ? (
				<ContextPanel
					citations={state.context.citations}
					focused={focused === 1}
					items={state.context.items}
					notices={state.context.notices}
				/>
			) : null}
		</>
	);
	const rightStack = (
		<>
			{isPanelOpen('rules') ? (
				<RulesPanel focused={focused === 2} sections={state.rules} />
			) : null}
			{isPanelOpen('approvals') ? (
				<ApprovalsPanel
					approvals={state.approvals}
					focused={focused === 3}
				/>
			) : null}
			{isPanelOpen('diffs') ? (
				<DiffsPanel diffs={state.diffs} focused={focused === 4} />
			) : null}
			{isPanelOpen('status') ? (
				<StatusPanel focused={focused === 5} status={state.status} />
			) : null}
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
				// Degraded single-panel layout: only focused panel; status only if opened
				<Box flexDirection="column" width="100%">
					{focused <= 1 ? leftStack : rightStack}
					{isPanelOpen('status') ? (
						<StatusPanel focused={false} status={state.status} />
					) : null}
				</Box>
			) : (
				// Responsive layout: single column if right side has no open panels
				(() => {
					const rightOpen =
						isPanelOpen('rules') ||
						isPanelOpen('approvals') ||
						isPanelOpen('diffs') ||
						isPanelOpen('status');
					if (!rightOpen) {
						return (
							<Box width="100%">
								<Box
									flexDirection="column"
									flexGrow={1}
									width="100%"
								>
									{leftStack}
								</Box>
							</Box>
						);
					}
					return (
						<Box width="100%">
							<Box
								flexDirection="column"
								flexGrow={1}
								width="60%"
							>
								{leftStack}
							</Box>
							<Box flexDirection="column" width="40%">
								{rightStack}
							</Box>
						</Box>
					);
				})()
			)}

			{/* Command palette overlay */}
			{paletteState.open ? (
				<Box flexDirection="column" paddingX={1} paddingY={0}>
					<Text>
						<Text color={theme.palette.accent}>/</Text>
						{paletteState.query}
					</Text>
					{paletteState.suggestions.slice(0, 6).map((s, i) => (
						<Text key={`${s.label}:${i}`}>
							{paletteState.selected === i ? (
								<Text color={theme.palette.accent}>➤ </Text>
							) : (
								<Text color="gray"> </Text>
							)}
							{s.label}
							{s.detail ? (
								<Text color="gray"> — {s.detail}</Text>
							) : null}
						</Text>
					))}
				</Box>
			) : null}

			{/* Footer hint */}
			<Box paddingX={1} paddingY={1}>
				<Text color="gray">
					Type to chat • Enter: send • /: commands • Cmd/Ctrl+K:
					palette • Tab/Shift+Tab: panels • r: render • t: theme • c:
					copy code • [ / ]: history • y/n: approve/reject • o: open
					diff • q: quit
				</Text>
			</Box>
		</Box>
	);
}
