import { Box, Text } from 'ink';
import { Section, SmallDim } from '../layout';
import type { TuiRuleSection } from '../types';

export function RulesPanel({
	sections,
	focused,
}: {
	sections?: TuiRuleSection[];
	focused?: boolean;
}) {
	const list = sections ?? [];
	return (
		<Section focused={focused} title="Rules">
			{list.length === 0 ? (
				<SmallDim>none</SmallDim>
			) : (
				<Box flexDirection="column">
					{list.map((s, idx) => (
						<Box flexDirection="column" key={idx} marginBottom={1}>
							<Text>
								<Text bold>{s.title}</Text>
								<SmallDim> [{s.scope}]</SmallDim>
							</Text>
							<Text wrap="truncate-end">{s.content}</Text>
						</Box>
					))}
				</Box>
			)}
		</Section>
	);
}
