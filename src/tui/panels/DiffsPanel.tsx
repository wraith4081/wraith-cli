import { Box, Text } from 'ink';
import { Section, SmallDim } from '../layout';
import type { TuiDiffEntry } from '../types';

export function DiffsPanel({
	diffs,
	focused,
}: {
	diffs?: TuiDiffEntry[];
	focused?: boolean;
}) {
	const list = diffs ?? [];
	return (
		<Section focused={focused} title="Diffs / Checkpoints">
			{list.length === 0 ? (
				<SmallDim>none</SmallDim>
			) : (
				<Box flexDirection="column">
					{list.map((d, idx) => (
						<Box flexDirection="column" key={idx} marginBottom={1}>
							<Text bold>• {d.title}</Text>
							{d.summary ? <Text>{d.summary}</Text> : null}
						</Box>
					))}
				</Box>
			)}
		</Section>
	);
}
