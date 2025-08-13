import {
	buildEffectiveSystemPrompt,
	getDefaultSystemPrompt,
	type RuleSection,
} from '@rules/manager';
import { describe, expect, it } from 'vitest';

describe('Rules Manager', () => {
	it('returns default system prompt when no sections/override provided', () => {
		const prompt = buildEffectiveSystemPrompt();
		expect(prompt).toContain(
			'You are Wraith: a helpful developer CLI assistant.'
		);
	});

	it('merges user and project sections in order and appends per-command override', () => {
		const user: RuleSection[] = [
			{ title: 'Tone', rules: ['Be friendly but concise.'] },
		];
		const project: RuleSection[] = [
			{
				title: 'Repo Conventions',
				rules: ['Use pnpm over npm.', 'Prefer ESM.'],
			},
		];
		const prompt = buildEffectiveSystemPrompt({
			defaultPrompt: getDefaultSystemPrompt(),
			userSections: user,
			projectSections: project,
			systemOverride: {
				mode: 'merge',
				content: 'Focus on performance in answers.',
			},
		});

		// Default present
		expect(prompt).toContain(
			'You are Wraith: a helpful developer CLI assistant.'
		);
		// User rules section
		expect(prompt).toContain('## User Rules');
		expect(prompt).toContain('### Tone');
		expect(prompt).toContain('- Be friendly but concise.');
		// Project rules section labeled
		expect(prompt).toContain('## Project Rules');
		expect(prompt).toContain('### Repo Conventions');
		expect(prompt).toContain('- Use pnpm over npm.');
		// Per-command override appended
		expect(prompt).toContain('## Per-Command System Override');
		expect(prompt).toContain('Focus on performance in answers.');
	});

	it('replace mode returns only override content', () => {
		const prompt = buildEffectiveSystemPrompt({
			defaultPrompt: getDefaultSystemPrompt(),
			systemOverride: {
				mode: 'replace',
				content: 'You are now a strict linter.',
			},
		});
		expect(prompt).toBe('You are now a strict linter.');
	});
});
