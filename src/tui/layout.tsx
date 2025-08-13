import { Box, Text } from 'ink';
import type React from 'react';
import { useTheme } from './theme';

export function Section({
	title,
	children,
	focused,
}: React.PropsWithChildren<{ title: string; focused?: boolean }>) {
	const { palette } = useTheme();
	const accent = focused ? palette.accent : 'gray';
	return (
		<Box flexDirection="column" paddingX={1} paddingY={0}>
			<Text>
				<Text color={accent}>
					{' '}
					{palette.dividerGlyph}
					{palette.dividerGlyph}{' '}
				</Text>
				<Text bold color={accent}>
					{title}
				</Text>
				<Text color="gray">
					{' '}
					{new Array(40).fill(palette.dividerGlyph).join('')}
				</Text>
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{children}
			</Box>
		</Box>
	);
}

export function SmallDim({ children }: React.PropsWithChildren) {
	const { palette } = useTheme();
	return <Text color={palette.dim}>{children}</Text>;
}
