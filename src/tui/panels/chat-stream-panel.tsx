import { Box, Text } from 'ink';
import { Section, SmallDim } from '../layout';
import { useTheme } from '../theme';

export function ChatStreamPanel(props: {
	input?: string;
	response?: string;
	streaming?: boolean;
	focused?: boolean;
}) {
	const { palette } = useTheme();
	return (
		<Section focused={props.focused} title="Chat">
			<Box flexDirection="column">
				{props.input ? (
					<Box flexDirection="column" marginBottom={1}>
						<Text color={palette.user}>you ▸</Text>
						<Text>{props.input}</Text>
					</Box>
				) : null}
				<Box flexDirection="column">
					<Text color={palette.assistant}>
						assistant ▸{' '}
						{props.streaming ? <SmallDim>…</SmallDim> : null}
					</Text>
					<Text wrap="wrap">{props.response ?? '…'}</Text>
				</Box>
			</Box>
		</Section>
	);
}
