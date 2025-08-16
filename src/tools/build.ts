/** biome-ignore-all lint/correctness/noUndeclaredVariables: false positive */
/** biome-ignore-all lint/suspicious/noConsole: tbd */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const os =
	process.platform === 'darwin'
		? 'macos'
		: process.platform === 'win32'
			? 'windows'
			: 'linux';
const arch = process.arch === 'x64' ? 'x64' : process.arch;
const ext = process.platform === 'win32' ? '.exe' : '';
mkdirSync('dist', { recursive: true });
const out = join('dist', `ai-${os}-${arch}${ext}`);
const res = await Bun.build({
	entrypoints: ['src/cli/ai.ts'],
	outdir: 'dist',
	naming: `ai-${os}-${arch}${ext}`,
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
console.log(`Built ${out}`);
