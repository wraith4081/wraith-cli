import React, { useMemo } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ColorLevel = 'truecolor' | '256' | 'basic';

export interface ThemePalette {
	accent: string | undefined; // for titles/accents
	dim: string | undefined; // for secondary text
	user: string | undefined; // "you"
	assistant: string | undefined; // "assistant"
	warn: string | undefined; // warnings
	dividerGlyph: '─' | '-';
}

export interface ThemeState {
	mode: ThemeMode;
	colorLevel: ColorLevel;
	palette: ThemePalette;
}

export interface ThemeController {
	setMode: (m: ThemeMode) => void;
}

export const ThemeContext = React.createContext<ThemeState>({
	mode: 'system',
	colorLevel: 'basic',
	palette: {
		accent: undefined,
		dim: undefined,
		user: undefined,
		assistant: undefined,
		warn: undefined,
		dividerGlyph: '-',
	},
});

export const ThemeCtlContext = React.createContext<ThemeController>({
	setMode: () => {
		//
	},
});

function detectColorLevel(): ColorLevel {
	try {
		// Node TTY provides getColorDepth() on stdout/stderr streams.
		const depth =
			process.stdout && typeof process.stdout.getColorDepth === 'function'
				? process.stdout.getColorDepth()
				: 8;
		if (depth >= 24) {
			return 'truecolor';
		}
		if (depth >= 8) {
			return '256';
		}
		return 'basic';
	} catch {
		return 'basic';
	}
}

function paletteFor(
	mode: Exclude<ThemeMode, 'system'>,
	lvl: ColorLevel
): ThemePalette {
	// Use only safe Ink color names; these degrade nicely across color depths.
	// When lvl === 'basic', Ink still supports named colors; divider falls back to '-'.
	const light: ThemePalette = {
		accent: 'blue',
		dim: 'gray',
		user: 'cyan',
		assistant: 'magenta',
		warn: 'yellow',
		dividerGlyph: lvl === 'basic' ? '-' : '─',
	};
	const dark: ThemePalette = {
		accent: 'cyan',
		dim: 'gray',
		user: 'cyan',
		assistant: 'magenta',
		warn: 'yellow',
		dividerGlyph: lvl === 'basic' ? '-' : '─',
	};
	return mode === 'light' ? light : dark;
}

function resolveMode(mode: ThemeMode): Exclude<ThemeMode, 'system'> {
	// We can expand later to respect env/OS; for now, default to dark in "system".
	return mode === 'system' ? 'dark' : mode;
}

export function useTheme(): ThemeState {
	return React.useContext(ThemeContext);
}

export function useThemeController(): ThemeController {
	return React.useContext(ThemeCtlContext);
}

export function ThemeProvider(
	props: React.PropsWithChildren<{ mode?: ThemeMode }>
) {
	const [mode, setMode] = React.useState<ThemeMode>(props.mode ?? 'system');
	const level = React.useMemo(() => detectColorLevel(), []);
	const eff = resolveMode(mode);
	const palette = React.useMemo(() => paletteFor(eff, level), [eff, level]);

	const state: ThemeState = React.useMemo(
		() => ({ mode, colorLevel: level, palette }),
		[mode, level, palette]
	);

	const ctl: ThemeController = useMemo(() => ({ setMode }), []);

	return (
		<ThemeContext.Provider value={state}>
			<ThemeCtlContext.Provider value={ctl}>
				{props.children}
			</ThemeCtlContext.Provider>
		</ThemeContext.Provider>
	);
}
