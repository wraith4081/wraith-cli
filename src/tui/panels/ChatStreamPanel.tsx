import { Box, Text } from 'ink';
import { Section } from '../layout';

export function ChatStreamPanel(props: { input?: string; response?: string }) {
	return (
		<Section title="Chat">
			<Box flexDirection="column">
				{props.input ? (
					<Box flexDirection="column" marginBottom={1}>
						<Text color="cyan">you ▸</Text>
						<Text>{props.input}</Text>
					</Box>
				) : null}
				<Box flexDirection="column">
					<Text color="magenta">assistant ▸</Text>
					<Text wrap="wrap">{props.response ?? '…'}</Text>
				</Box>
			</Box>
		</Section>
	);
}
