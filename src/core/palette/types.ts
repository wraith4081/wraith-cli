import type { Suggestion } from '../command/autocomplete.js';

export interface PaletteOptions {
	persistOnExecute?: boolean;
}

export interface PaletteState {
	open: boolean;
	query: string;
	suggestions: Suggestion[];
	selected: number; // -1 means none
	lastMessage?: string;
}
