/** biome-ignore-all lint/correctness/noUndeclaredVariables: false positive */
/** biome-ignore-all lint/suspicious/noConsole: tbd */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

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
const outPath = join('dist', binName);

// Build a native single-file executable using Bun's compiler
const proc = Bun.spawnSync({
	cmd: [
		'bun',
		'build',
		'src/cli/ai.ts',
		'--compile',
		'--minify',
		'--outfile',
		outPath,
	],
});

if (proc.exitCode !== 0) {
	console.error('Build failed with exit code', proc.exitCode);
	if (proc.stderr) {
		console.error(new TextDecoder().decode(proc.stderr));
	}
	process.exit(proc.exitCode || 1);
}

async function sha256File(p: string) {
	const buf = await Bun.file(p).arrayBuffer();
	const h = createHash('sha256');
	h.update(Buffer.from(buf));
	return h.digest('hex');
}

const binSha = await sha256File(outPath);
writeFileSync(`${outPath}.sha256`, `${binSha}  ${basename(outPath)}\n`);

console.log(`Built ${outPath}`);
