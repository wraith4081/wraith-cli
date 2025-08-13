import { Box, Text } from 'ink';
import type React from 'react';

export function Section({
	title,
	children,
}: React.PropsWithChildren<{ title: string }>) {
	return (
		<Box flexDirection="column" paddingX={1} paddingY={0}>
			<Text>
				<Text color="gray">── </Text>
				<Text bold>{title}</Text>
				<Text color="gray">
					{' '}
					─────────────────────────────────────────
				</Text>
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{children}
			</Box>
		</Box>
	);
}

export function SmallDim({ children }: React.PropsWithChildren) {
	return <Text color="gray">{children}</Text>;
}
