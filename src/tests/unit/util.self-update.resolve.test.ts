import { resolveLatestAsset } from '@util/self-update';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from 'vitest';

const ext = process.platform === 'win32' ? '.exe' : '';
const os =
	process.platform === 'darwin'
		? 'macos'
		: process.platform === 'win32'
			? 'windows'
			: 'linux';
const arch = process.arch === 'x64' ? 'x64' : process.arch;

describe('util.selfupdate.resolveLatestAsset', () => {
	const origFetch = globalThis.fetch;

	beforeEach(() => {
		// stub global fetch
		// @ts-expect-error - test stub
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = origFetch;
	});

	it('picks the exact matching asset for platform/arch', async () => {
		const name = `ai-${os}-${arch}${ext}`;
		const assets = [
			{
				name: `ai-${os}-arm64${ext}`,
				browser_download_url: 'https://example.com/arm64',
			},
			{ name, browser_download_url: 'https://example.com/match' },
		];
		(fetch as unknown as Mock).mockResolvedValueOnce({
			ok: true,
			json: async () => ({ tag_name: 'v1.2.3', assets }),
		});

		const res = await resolveLatestAsset({ repo: 'acme/wraith' });
		expect(res.name).toBe(name);
		expect(res.url).toBe('https://example.com/match');
		expect(res.tag).toBe('v1.2.3');
	});

	it('throws a helpful error if no asset matches', async () => {
		(fetch as unknown as Mock).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				tag_name: 'v0.0.1',
				assets: [{ name: 'ai-other-thing', browser_download_url: 'x' }],
			}),
		});
		await expect(
			resolveLatestAsset({ repo: 'acme/wraith' })
		).rejects.toThrow(/No matching asset/);
	});
});
