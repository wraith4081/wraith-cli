import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type UpdateChannel = 'latest'; // (future: "canary", "beta", tags)

const DEFAULT_REPO = process.env.WRAITH_REPO || 'wraith4081/wraith-cli';

function platformTag() {
	const p = process.platform;
	if (p === 'darwin') {
		return 'macos';
	}
	if (p === 'win32') {
		return 'windows';
	}
	return 'linux';
}
function archTag() {
	const a = process.arch;
	if (a === 'x64') {
		return 'x64';
	}
	if (a === 'arm64') {
		return 'arm64';
	}
	return a; // fallback, e.g. arm
}

function isCompiledBinary(): boolean {
	// If we're running via Bun itself, execPath will look like ".../bun" or "bun.exe".
	const base = path.basename(process.execPath).toLowerCase();
	return !(base === 'bun' || base === 'bun.exe');
}

function binaryExt() {
	return process.platform === 'win32' ? '.exe' : '';
}

export async function resolveLatestAsset(opts?: {
	repo?: string;
	channel?: UpdateChannel;
	assetName?: string; // for tests / overrides
}): Promise<{ name: string; url: string; tag: string }> {
	const repo = opts?.repo || DEFAULT_REPO;
	const res = await fetch(
		`https://api.github.com/repos/${repo}/releases/latest`,
		{
			headers: { 'User-Agent': 'wraith-cli-self-update' },
		}
	);
	if (!res.ok) {
		throw new Error(`GitHub API error: ${res.status}`);
	}
	const json = (await res.json()) as Record<string, unknown>;
	const tag = json?.tag_name || 'latest';
	const assets: Record<string, unknown>[] = Array.isArray(json?.assets)
		? json.assets
		: [];
	const expected =
		opts?.assetName ??
		`wraith-cli-${platformTag()}-${archTag()}${binaryExt()}`;

	const asset =
		assets.find((a) => a?.name === expected) ??
		assets.find(
			(a) =>
				String(a?.name).includes(platformTag()) &&
				String(a?.name).includes(archTag())
		);

	if (!asset?.browser_download_url) {
		const names = assets
			.map((a) => a?.name)
			.filter(Boolean)
			.join(', ');
		throw new Error(
			`No matching asset "${expected}" for ${platformTag()}/${archTag()} in [${names}]`
		);
	}
	return {
		name: asset.name as string,
		url: asset.browser_download_url as string,
		tag: tag as string,
	};
}

async function downloadToTemp(url: string): Promise<string> {
	const r = await fetch(url, {
		headers: { 'User-Agent': 'wraith-cli-self-update' },
	});
	if (!r.ok) {
		throw new Error(`Download failed: ${r.status}`);
	}
	const ab = await r.arrayBuffer();
	const buf = Buffer.from(ab);
	const file = path.join(
		os.tmpdir(),
		`wraith-selfupdate-${Date.now()}-${Math.random().toString(36).slice(2)}${binaryExt()}`
	);
	fs.writeFileSync(file, buf);
	if (process.platform !== 'win32') {
		try {
			fs.chmodSync(file, 0o755);
		} catch {
			/* ignore */
		}
	}
	return file;
}

export async function selfUpdate(opts?: {
	repo?: string;
	dryRun?: boolean;
}): Promise<{
	updated: boolean;
	message: string;
	to?: string;
	from?: string;
	tag?: string;
	manual?: boolean;
}> {
	if (!isCompiledBinary()) {
		return {
			updated: false,
			manual: true,
			message:
				"You're running via Bun (not a compiled binary). Build a binary with `bun build --compile` or install a release artifact.",
		};
	}

	const current = process.execPath;
	const { url, name, tag } = await resolveLatestAsset({ repo: opts?.repo });

	const tmp = await downloadToTemp(url);
	if (opts?.dryRun) {
		return {
			updated: false,
			message: `Downloaded ${name} to ${tmp} (dry-run)`,
			to: current,
			from: tmp,
			tag,
		};
	}

	// Try atomic replace in-place
	const dir = path.dirname(current);
	const final = current;
	const staged = path.join(dir, `${path.basename(final)}.new${binaryExt()}`);
	try {
		// Move downloaded file next to current binary
		if (fs.existsSync(staged)) {
			fs.rmSync(staged, { force: true });
		}
		fs.renameSync(tmp, staged);

		try {
			// On Linux/macOS this typically works even while running.
			fs.renameSync(staged, final);
			return {
				updated: true,
				message: `Updated to ${name} (${tag}).`,
				to: final,
				tag,
			};
		} catch {
			// Windows: cannot replace running exe. Leave the .new file and instruct manual swap.
			return {
				updated: false,
				manual: true,
				message:
					`Downloaded new binary to:\n  ${staged}\n` +
					`Windows cannot replace a running executable. After this process exits, rename it to:\n  ${final}\n` +
					`Or run PowerShell as Admin:\n  Move-Item -Force "${staged}" "${final}"`,
				to: final,
				from: staged,
				tag,
			};
		}
	} catch (err) {
		return {
			updated: false,
			manual: true,
			message:
				`Failed to stage update: ${(err as Error)?.message || err}. ` +
				`Manual download: ${url}`,
			to: final,
			from: tmp,
			tag,
		};
	}
}
