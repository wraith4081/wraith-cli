/** biome-ignore-all lint/correctness/noUndeclaredVariables: false positive */
/** biome-ignore-all lint/suspicious/noConsole: tbd */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'wraith-cli';

const os =
	process.platform === 'darwin'
		? 'macos'
		: process.platform === 'win32'
			? 'windows'
			: 'linux';

const arch = process.arch === 'x64' ? 'x64' : process.arch; // normalize x64
const ext = process.platform === 'win32' ? '.exe' : '';

mkdirSync('dist', { recursive: true });

const binName = `${BASE}-${os}-${arch}${ext}`;
const mapName = `${BASE}-${os}-${arch}${ext}.map`;

const res = await Bun.build({
	entrypoints: ['src/cli/ai.ts'],
	outdir: 'dist',
	naming: binName,
	target: 'bun',
	minify: true,
	sourcemap: 'external',
	splitting: false,
	format: 'esm',
});

if (!res.success) {
	console.error('Build failed:');
	for (const m of res.logs) {
		console.error(m.message);
	}
	process.exit(1);
}

const binPath = join('dist', binName);
const mapPath = join('dist', mapName);

const sha256 = async (p: string) => {
	const h = createHash('sha256');
	h.update(await Bun.file(p).text());
	return h.digest('hex');
};

const binSha = sha256(binPath);
writeFileSync(`${binPath}.sha256`, `${binSha}  ${binName}\n`);

try {
	const mapSha = sha256(mapPath);
	writeFileSync(`${mapPath}.sha256`, `${mapSha}  ${mapName}\n`);
} catch {
	// map might not exist (older bun); ignore
}

console.log(`Built ${binPath}`);
