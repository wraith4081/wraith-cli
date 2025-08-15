import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	listTemplates,
	loadTemplateContent,
	parseVarsArg,
	renderTemplate,
	resolveTemplateByName,
	type TemplateMeta,
} from '@util/templates';
import { beforeEach, describe, expect, it } from 'vitest';

function mkTmpProject(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-'));
	process.chdir(d);
	return d;
}

describe('templates utility', () => {
	beforeEach(() => {
		mkTmpProject();
		const dir = path.join(process.cwd(), '.wraith', 'templates');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'greeting.md'),
			`---
name: greeting
description: Friendly hello
---
# Hello {{name}}

Welcome to {{project}}.
`,
			'utf8'
		);
	});

	it('lists templates with metadata', () => {
		const list = listTemplates();
		expect(list.length).toBe(1);
		expect(list[0].name).toBe('greeting');
		expect(list[0].scope).toBe('project');
		expect(list[0].variables).toEqual(['name', 'project']);
		expect(list[0].description).toContain('Friendly');
	});

	it('loads and renders a template; validates missing vars', () => {
		const meta = resolveTemplateByName('greeting');
		expect(meta).toBeTruthy();
		const raw = loadTemplateContent(meta as TemplateMeta);

		const { missing } = renderTemplate(
			raw.replace(/^---[\s\S]*?\n---\s*\n/, ''),
			{ name: 'Ada' }
		);
		expect(missing).toEqual(['project']);
		const ok = renderTemplate(raw.replace(/^---[\s\S]*?\n---\s*\n/, ''), {
			name: 'Ada',
			project: 'Wraith',
		});
		expect(ok.missing).toEqual([]);
		expect(ok.output).toContain('Hello Ada');
		expect(ok.output).toContain('Welcome to Wraith.');
	});

	it('parses vars from --vars and --var styles', () => {
		const parsed = parseVarsArg(['a=1;b=2', 'x= y z '], ['c=3', 'a=9']);
		expect(parsed).toEqual({ a: '9', b: '2', x: 'y z', c: '3' }); // right-most wins for 'a'
	});
});
