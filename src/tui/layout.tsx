import { Box, Text } from 'ink';
import type React from 'react';

export function Section({
	title,
	children,
	focused,
}: React.PropsWithChildren<{ title: string; focused?: boolean }>) {
	return (
		<Box flexDirection="column" paddingX={1} paddingY={0}>
			<Text>
				<Text color={focused ? 'cyan' : 'gray'}>── </Text>
				<Text bold color={focused ? 'cyan' : undefined}>
					{title}
				</Text>
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
