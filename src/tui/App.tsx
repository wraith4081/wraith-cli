import { Box, Text } from 'ink';
import { ApprovalsPanel } from './panels/ApprovalsPanel';
import { ChatStreamPanel } from './panels/ChatStreamPanel';
import { ContextPanel } from './panels/ContextPanel';
import { DiffsPanel } from './panels/DiffsPanel';
import { RulesPanel } from './panels/RulesPanel';
import { StatusPanel } from './panels/StatusPanel';
import type { TuiShellProps } from './types';

export default function App(props: TuiShellProps) {
	return (
		<Box flexDirection="column" width="100%">
			{/* Title bar */}
			<Box paddingX={1} paddingY={0}>
				<Text bold>{props.title ?? 'wraith • session'}</Text>
			</Box>

			{/* 2-column layout */}
			<Box width="100%">
				{/* Left column (primary) */}
				<Box flexDirection="column" flexGrow={1} width="60%">
					<ChatStreamPanel
						input={props.chat?.input}
						response={props.chat?.response}
					/>
					<ContextPanel
						citations={props.context?.citations}
						items={props.context?.items}
					/>
				</Box>

				{/* Right column (secondary stack) */}
				<Box flexDirection="column" width="40%">
					<RulesPanel sections={props.rules} />
					<ApprovalsPanel approvals={props.approvals} />
					<DiffsPanel diffs={props.diffs} />
					<StatusPanel status={props.status} />
				</Box>
			</Box>

			{/* Footer hint */}
			<Box paddingX={1} paddingY={1}>
				<Text color="gray">
					◂ Tab to navigate (coming soon) • Ctrl+C to quit (or abort
					stream)
				</Text>
			</Box>
		</Box>
	);
}
