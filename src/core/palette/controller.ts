import type { Announcer } from '../a11y/announcer.js';
import {
	type AutocompleteOptions,
	type CommandRegistry,
	parseCommand,
	suggest,
} from '../command/index.js';
import type { PaletteOptions, PaletteState } from './types.js';

function splitForCompletion(input: string): {
	prefixBefore: string;
	token: string;
	isFirstToken: boolean;
	endsWithSpace: boolean;
} {
	const endsWithSpace = /\s$/.test(input);
	const trimmed = input.trimStart();
	const body = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
	const tokens = body.split(/\s+/);
	if (!body.length) {
		return {
			prefixBefore: input,
			token: '',
			isFirstToken: true,
			endsWithSpace,
		};
	}
	if (endsWithSpace) {
		return {
			prefixBefore: input,
			token: '',
			isFirstToken: tokens.length === 1,
			endsWithSpace,
		};
	}
	const last = tokens.at(-1) ?? '';
	const before = input.slice(0, input.length - last.length);
	return {
		prefixBefore: before,
		token: last,
		isFirstToken: tokens.length === 1,
		endsWithSpace,
	};
}

export class PaletteController {
	private state: PaletteState = {
		open: false,
		query: '',
		suggestions: [],
		selected: -1,
	};
	private opts: PaletteOptions;
	private reg: CommandRegistry;
	private provider?: AutocompleteOptions['argumentValues'];
	private a11y?: Announcer;

	constructor(
		registry: CommandRegistry,
		options: PaletteOptions = {},
		provider?: AutocompleteOptions['argumentValues'],
		announcer?: Announcer
	) {
		this.reg = registry;
		this.opts = options;
		this.provider = provider;
		this.a11y = announcer;
	}

	getState(): PaletteState {
		return { ...this.state, suggestions: [...this.state.suggestions] };
	}

	async open() {
		this.state.open = true;
		await this.refresh();
	}

	close() {
		this.state.open = false;
		this.state.selected = -1;
		this.state.suggestions = [];
	}

	toggle() {
		if (this.state.open) {
			return this.close();
		}
		return this.open();
	}

	async input(text: string) {
		this.state.query += text;
		await this.refresh();
	}

	async setQuery(text: string) {
		this.state.query = text;
		await this.refresh();
	}

	async key(key: 'ArrowUp' | 'ArrowDown' | 'Tab' | 'Enter' | 'Escape') {
		switch (key) {
			case 'ArrowDown': {
				const max = this.state.suggestions.length;
				if (max === 0) {
					return;
				}
				this.state.selected = (this.state.selected + 1 + max) % max;
				this.announceSelection();
				return;
			}
			case 'ArrowUp': {
				const max = this.state.suggestions.length;
				if (max === 0) {
					return;
				}
				this.state.selected = (this.state.selected - 1 + max) % max;
				this.announceSelection();
				return;
			}
			case 'Tab': {
				await this.acceptSelected();
				return;
			}
			case 'Enter': {
				await this.execute();
				return;
			}
			case 'Escape': {
				await this.close();
				return;
			}
			default: {
				return;
			}
		}
	}

	private async acceptSelected() {
		const sel =
			this.state.selected >= 0
				? this.state.suggestions[this.state.selected]
				: this.state.suggestions[0];
		if (!sel) {
			return;
		}
		const { prefixBefore, isFirstToken, endsWithSpace } =
			splitForCompletion(this.state.query);
		let newQuery = this.state.query;
		if (sel.kind === 'command') {
			// Complete command id; ensure trailing space
			const base =
				isFirstToken && !endsWithSpace
					? prefixBefore
					: this.state.query;
			if (isFirstToken && !endsWithSpace) {
				newQuery = `${base}${sel.label} `;
			} else if (isFirstToken && endsWithSpace) {
				newQuery = `${base}${sel.label} `;
			} else {
				newQuery = `${prefixBefore}${sel.label} `;
			}
		} else if (endsWithSpace) {
			newQuery = `${this.state.query}${sel.label} `;
		} else {
			newQuery = `${prefixBefore}${sel.label} `;
		}
		this.state.query = newQuery;
		await this.refresh();
	}

	private async refresh() {
		if (!this.state.open) {
			return;
		}
		const suggestions = await suggest(this.state.query, this.reg, {
			argumentValues: this.provider,
		});
		this.state.suggestions = suggestions;
		// reset selection to first item if out of range
		this.state.selected = suggestions.length
			? Math.min(this.state.selected, suggestions.length - 1)
			: -1;
		if (this.state.selected < 0 && suggestions.length) {
			this.state.selected = 0;
		}
		this.announceSuggestions();
	}

	async execute() {
		// Try to parse and execute; report message and close unless persist
		try {
			const { id, argv } = parseCommand(this.state.query);
			await this.reg.execute(id, argv, {});
			this.state.lastMessage = 'ok';
			this.a11y?.announce('Command executed', 'polite');
			if (!this.opts.persistOnExecute) {
				await this.close();
			}
		} catch (err) {
			this.state.lastMessage = (err as Error).message || 'error';
			this.a11y?.announce(this.state.lastMessage, 'assertive');
		}
	}

	private announceSuggestions() {
		if (!this.a11y) {
			return;
		}
		const n = this.state.suggestions.length;
		const sel =
			this.state.selected >= 0
				? this.state.suggestions[this.state.selected]
				: undefined;
		const msg =
			n === 0
				? 'No suggestions'
				: `${n} suggestions${sel ? `, ${sel.label} selected` : ''}`;
		this.a11y.announce(msg, 'polite');
	}

	private announceSelection() {
		if (!this.a11y) {
			return;
		}
		const sel =
			this.state.selected >= 0
				? this.state.suggestions[this.state.selected]
				: undefined;
		if (sel) {
			this.a11y.announce(`${sel.label}`, 'polite');
		}
	}
}
