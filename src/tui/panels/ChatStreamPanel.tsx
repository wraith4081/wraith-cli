import { Box, Text } from 'ink';
import { Section, SmallDim } from '../layout';

export function ChatStreamPanel(props: {
	input?: string;
	response?: string;
	streaming?: boolean;
	focused?: boolean;
}) {
	return (
		<Section focused={props.focused} title="Chat">
			<Box flexDirection="column">
				{props.input ? (
					<Box flexDirection="column" marginBottom={1}>
						<Text color="cyan">you ▸</Text>
						<Text>{props.input}</Text>
					</Box>
				) : null}
				<Box flexDirection="column">
					<Text color="magenta">
						assistant ▸{' '}
						{props.streaming ? <SmallDim>…</SmallDim> : null}
					</Text>
					<Text wrap="wrap">{props.response ?? '…'}</Text>
				</Box>
			</Box>
		</Section>
	);
}
