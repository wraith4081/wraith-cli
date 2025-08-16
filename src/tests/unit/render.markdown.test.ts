/** biome-ignore-all lint/suspicious/noControlCharactersInRegex: test */
import { mdToAnsi, mdToPlain, renderText } from '@render/index';
import { describe, expect, it } from 'vitest';

const sample = `# Title

Some **bold** and _italic_ with \`code\`.

- Item 1
- Item 2

A link: [site](https://example.com)

\`\`\`ts
const x = 1
\`\`\`
`;

describe('render/markdown', () => {
	it('mdToPlain drops markdown markers', () => {
		const out = mdToPlain(sample);
		expect(out).not.toMatch(/#/);
		expect(out).toMatch(/Title/);
		expect(out).not.toMatch(/\*\*|__/);
		expect(out).toMatch(/bold/);
		expect(out).not.toMatch(/`/);
		expect(out).toMatch(/code/);
		expect(out).toMatch(/Item 1/);
		expect(out).toMatch(/site \(https:\/\/example\.com\)/);
		expect(out).not.toMatch(/```/);
	});

	it('mdToAnsi inserts ANSI escapes', () => {
		const out = mdToAnsi(sample);
		// contains some ESC markers and not raw fences
		expect(out).toMatch(/\u001b\[/);
		expect(out).not.toMatch(/```/);
	});

	it('renderText chooses by mode', () => {
		expect(renderText('x', 'markdown')).toBe('x');
		expect(renderText('**x**', 'plain')).toBe('x');
		expect(renderText('**x**', 'ansi')).toMatch(/\u001b\[/);
	});
});
