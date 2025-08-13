// Minimal Markdown → plain / ANSI converters (stream-safe if used post-hoc)
const ESC = '\u001b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const UNDER = `${ESC}4m`;
const FG_GRAY = `${ESC}90m`;
const CODE = FG_GRAY; // use gray for code blocks/inline

export function mdToPlain(input: string): string {
	// Code fences: strip the ```lang markers, keep code content
	let s = input.replace(/```([\w-]+)?\s*[\r\n]?/g, '').replace(/```/g, '');

	// Inline code
	s = s.replace(/`([^`]+)`/g, '$1');

	// Headings: "# Title" → "Title"
	s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');

	// Bold/italic: **x** / *x* → x  (keep content)
	s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
	s = s.replace(/__([^_]+)__/g, '$1').replace(/_([^_]+)_/g, '$1');

	// Blockquotes: "> x" → "x"
	s = s.replace(/^\s{0,3}>\s?/gm, '');

	// Links: [text](url) → "text (url)"
	s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

	// Images: ![alt](url) → "alt (url)"
	s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)');

	// Lists: keep markers; normalize nested spacing
	s = s.replace(/^\s*[-*+]\s+/gm, '- ');

	// Horizontal rules: remove
	s = s.replace(/^\s*-{3,}\s*$/gm, '');

	return s;
}

export function mdToAnsi(input: string): string {
	let s = input;

	// Code fences → gray preformatted blocks
	s = s.replace(
		/```([\w-]+)?\s*[\r\n]([\s\S]*?)```/g,
		(_m, lang: string | undefined, body: string) => {
			const langTag = lang ? `${DIM}${FG_GRAY}[${lang}]${RESET}\n` : '';
			return `\n${langTag}${CODE}${body.replace(/\r?\n/g, '\n')}${RESET}\n`;
		}
	);

	// Inline code → gray
	s = s.replace(/`([^`]+)`/g, `${CODE}$1${RESET}`);

	// Headings → bold
	s = s.replace(
		/^\s{0,3}#{1,6}\s+([^\n]+)$/gm,
		(_m, t: string) => `${BOLD}${t}${RESET}`
	);

	// Bold / italic
	s = s.replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${RESET}`);
	s = s.replace(/__([^_]+)__/g, `${BOLD}$1${RESET}`);
	s = s.replace(/\*([^*]+)\*/g, `${DIM}$1${RESET}`);
	s = s.replace(/_([^_]+)_/g, `${DIM}$1${RESET}`);

	// Blockquotes
	s = s.replace(/^\s{0,3}>\s?(.*)$/gm, `${DIM}> $1${RESET}`);

	// Links: underline text + faint URL in parens
	s = s.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		`${UNDER}$1${RESET} ${DIM}($2)${RESET}`
	);

	// Images: italic alt + faint URL
	s = s.replace(
		/!\[([^\]]*)\]\(([^)]+)\)/g,
		`${DIM}$1${RESET} ${DIM}($2)${RESET}`
	);

	// Lists: keep markers; dim bullets
	s = s.replace(
		/^(\s*)([-*+])\s+/gm,
		(_m, pad: string) => `${pad}${DIM}•${RESET} `
	);

	return s;
}

export type RenderMode = 'plain' | 'markdown' | 'ansi';

export function renderText(text: string, mode: RenderMode): string {
	switch (mode) {
		case 'plain':
			return mdToPlain(text);
		case 'ansi':
			return mdToAnsi(text);
		default:
			return text; // markdown: pass-through
	}
}
