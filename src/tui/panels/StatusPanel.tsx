import { Box, Text } from 'ink';
import { Section, SmallDim } from '../layout';
import type { TuiStatus } from '../types';

export function StatusPanel({ status }: { status?: TuiStatus }) {
	const s = status ?? {};
	return (
		<Section title="Status / Usage">
			<Box flexDirection="column">
				<Text>
					Model: <Text bold>{s.model ?? 'unknown'}</Text>
					{s.profile ? <SmallDim> [{s.profile}]</SmallDim> : null}
				</Text>
				<Text>
					State: <Text bold>{s.state ?? 'idle'}</Text>
					{s.latencyMs != null ? (
						<SmallDim> • {s.latencyMs}ms</SmallDim>
					) : null}
				</Text>
				<Text>
					Tokens:{' '}
					<SmallDim>
						prompt {s.promptTokens ?? 0} • completion{' '}
						{s.completionTokens ?? 0} • total {s.totalTokens ?? 0}
					</SmallDim>
				</Text>
				{s.message ? <Text>{s.message}</Text> : null}
			</Box>
		</Section>
	);
}
