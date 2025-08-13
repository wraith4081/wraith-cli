import { Box, Text } from 'ink';
import { Section, SmallDim } from '../layout';
import type { TuiApproval } from '../types';

export function ApprovalsPanel({ approvals }: { approvals?: TuiApproval[] }) {
	const list = approvals ?? [];
	return (
		<Section title="Tool Approvals">
			{list.length === 0 ? (
				<SmallDim>no pending tool calls</SmallDim>
			) : (
				<Box flexDirection="column">
					{list.map((a, idx) => (
						<Text key={idx}>
							• <Text bold>{a.tool}</Text>: {a.desc}{' '}
							{a.pending ? <SmallDim>[pending]</SmallDim> : null}
						</Text>
					))}
				</Box>
			)}
		</Section>
	);
}
