import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	buildIgnoreFilterFromConfig,
	buildIgnoreFilterFromSettings,
} from '@ingest/ignore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function mkTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ign-'));
}

describe('Ignore Engine', () => {
	let root: string;

	beforeEach(() => {
		root = mkTmp();
		fs.mkdirSync(root, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(root, { recursive: true, force: true });
		} catch {}
	});

	it('respects .gitignore when enabled', () => {
		fs.writeFileSync(
			path.join(root, '.gitignore'),
			'dist/\nnode_modules/\n',
			'utf8'
		);
		const filter = buildIgnoreFilterFromSettings({
			rootDir: root,
			useGitIgnore: true,
		});
		expect(filter(path.join(root, 'src/index.ts'))).toBe(true);
		expect(filter(path.join(root, 'dist/bundle.js'))).toBe(false);
		expect(filter(path.join(root, 'node_modules/pkg/index.js'))).toBe(
			false
		);
	});

	it('applies extra ignore patterns', () => {
		const filter = buildIgnoreFilterFromSettings({
			rootDir: root,
			useGitIgnore: false,
			patterns: ['secret.txt', '*.log'],
		});
		fs.writeFileSync(path.join(root, 'secret.txt'), 'x', 'utf8');
		fs.writeFileSync(path.join(root, 'app.log'), 'y', 'utf8');
		expect(filter('secret.txt')).toBe(false);
		expect(filter('app.log')).toBe(false);
		expect(filter('src/app.ts')).toBe(true);
	});

	it('honors includeAlways exceptions (e.g., .wraith/**) even if ignored by patterns', () => {
		// Ignore everything with "*", but include .wraith/**
		const filter = buildIgnoreFilterFromSettings({
			rootDir: root,
			useGitIgnore: false,
			patterns: ['*'],
			includeAlways: ['.wraith/**'],
		});
		fs.mkdirSync(path.join(root, '.wraith', 'specs'), { recursive: true });
		expect(filter('.wraith/specs/feature.md', true)).toBe(true);
		expect(filter('src/anything.ts')).toBe(false);
	});

	it('buildIgnoreFilterFromConfig derives defaults.ingestion (includeAlways .wraith/**)', () => {
		const cfg = {
			version: '1',
			defaults: {
				ingestion: { ignore: { useGitIgnore: false, patterns: ['*'] } },
			},
		};
		const filter = buildIgnoreFilterFromConfig(root, cfg);
		expect(filter('.wraith/specs/doc.md', true)).toBe(true);
		expect(filter('README.md')).toBe(false);
	});

	it('normalizes Windows-style backslashes', () => {
		const filter = buildIgnoreFilterFromSettings({
			rootDir: root,
			useGitIgnore: false,
			patterns: ['build/'],
			includeAlways: [],
		});
		const winLike = `build${path.sep}out.txt`;
		expect(filter(winLike)).toBe(false);
	});
});
