import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolPermissionError } from '@tools/errors';
import { discoverAndRegisterPlugins } from '@tools/plugins';
import { ToolRegistry } from '@tools/registry';
import type { ToolContext } from '@tools/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpRoot: string;
beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-plug-net-'));
});
afterEach(() => {
	try {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

function writePlugin(dir: string) {
	const d = path.join(dir, 'netty');
	fs.mkdirSync(d, { recursive: true });
	// minimal manifest requesting "net"
	const manifest = [
		'name: netty',
		'version: 0.0.1',
		'main: index.mjs',
		'permissions:',
		'  - net',
	].join('\n');
	fs.writeFileSync(path.join(d, 'plugin.yaml'), manifest, 'utf8');

	// ESM module exporting register(reg)
	const index = `
export function register(reg){
  reg.register({ name: 'dummy.ping', requiredPermissions: ['net'] }, () => 'pong');
}
`;
	fs.writeFileSync(path.join(d, 'index.mjs'), index, 'utf8');
	return d;
}

describe('plugin loader net permission deferral with prompt mode', () => {
	it('throws at load time when enforce=true and prompting is not enabled', async () => {
		const pluginDir = writePlugin(tmpRoot);
		const reg = new ToolRegistry();

		await expect(
			discoverAndRegisterPlugins(reg, {
				projectPluginsDir: tmpRoot,
				userPluginsDir: '',
				enforcePermissions: true,
				policy: {
					allowPermissions: [], // nothing granted
					denyPermissions: [], // not explicitly denied
					onMissingPermission: 'deny', // no prompt available -> should fail now
				} as ToolContext['policy'],
				projectDir: pluginDir,
			})
		).rejects.toBeInstanceOf(ToolPermissionError);
	});

	it('defers permission enforcement when onMissingPermission=prompt; tool runs after approval', async () => {
		const pluginDir = writePlugin(tmpRoot);
		const reg = new ToolRegistry();

		// Should NOT throw — registration allowed, actual permission checked at call-time
		const { loaded } = await discoverAndRegisterPlugins(reg, {
			projectPluginsDir: tmpRoot,
			userPluginsDir: '',
			enforcePermissions: true,
			policy: {
				allowPermissions: [],
				onMissingPermission: 'prompt',
			} as ToolContext['policy'],
			projectDir: pluginDir,
		});
		expect(loaded.length).toBe(1);
		expect(loaded[0]?.registered).toBe(true);

		// Now attempt to run the tool with prompting context
		let asked = 0;
		const ctx: ToolContext = {
			cwd: process.cwd(),
			policy: { onMissingPermission: 'prompt', allowPermissions: [] },
			ask: () => {
				asked++;
				return true;
			},
		};

		const out = await reg.run('dummy.ping', {}, ctx);
		expect(out).toBe('pong');
		expect(asked).toBe(1);
		// cached grant
		expect(new Set(ctx.policy.allowPermissions)).toContain('net');
	});
});
