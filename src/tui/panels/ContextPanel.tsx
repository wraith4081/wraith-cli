import { Box, Text } from 'ink';
import { Section, SmallDim } from '../layout';
import type { TuiCitation, TuiContextItem } from '../types';

export function ContextPanel(props: {
	items?: TuiContextItem[];
	citations?: TuiCitation[];
}) {
	const items = props.items ?? [];
	const cites = props.citations ?? [];
	return (
		<Section title="Context / Citations">
			<Box flexDirection="column">
				<Text bold>Included</Text>
				{items.length === 0 ? (
					<SmallDim>none</SmallDim>
				) : (
					items.map((i, idx) => (
						<Text key={idx}>
							• {i.label}
							{i.detail ? (
								<SmallDim> — {i.detail}</SmallDim>
							) : null}
						</Text>
					))
				)}
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Citations</Text>
					{cites.length === 0 ? (
						<SmallDim>none</SmallDim>
					) : (
						cites.map((c, idx) => (
							<Text key={idx}>
								• {c.label}
								{c.source ? (
									<SmallDim> ({c.source})</SmallDim>
								) : null}
							</Text>
						))
					)}
				</Box>
			</Box>
		</Section>
	);
}
