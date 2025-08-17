import { CommandError, type ParsedCommand } from './types.js';

// Simple tokenizer supporting quoted args ("..." or '...') and escapes \" \' \\
function tokenize(input: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quote: '"' | "'" | null = null;
	let esc = false;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (esc) {
			cur += ch;
			esc = false;
			continue;
		}
		if (ch === '\\') {
			esc = true;
			continue;
		}
		if (quote) {
			if (ch === quote) {
				quote = null;
			} else {
				cur += ch;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch as '"' | "'";
			continue;
		}
		if (/\s/.test(ch)) {
			if (cur) {
				out.push(cur);
				cur = '';
			}
			continue;
		}
		cur += ch;
	}
	if (quote) {
		throw new CommandError('EPARSE', 'Unterminated quoted argument');
	}
	if (esc) {
		throw new CommandError('EPARSE', 'Dangling escape at end of input');
	}
	if (cur) {
		out.push(cur);
	}
	return out;
}

export function parseCommand(line: string): ParsedCommand {
	const trimmed = line.trim();
	if (!trimmed) {
		throw new CommandError('EPARSE', 'Empty command line');
	}

	const noSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
	const tokens = tokenize(noSlash);
	const [id, ...argv] = tokens;
	if (!id) {
		throw new CommandError('EPARSE', 'Missing command id');
	}
	return { id, argv };
}

export { tokenize };
