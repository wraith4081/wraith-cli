import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolPermissionError } from '@tools/errors';
import { discoverAndRegisterPlugins } from '@tools/plugins';
import { ToolRegistry } from '@tools/registry';
import type { Permission, ToolContext } from '@tools/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function write(p: string, s: string) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, s, 'utf8');
}

function ctx(cwd: string, allowPermissions?: Permission[]): ToolContext {
	return {
		cwd,
		policy: { allowPermissions },
	};
}

let proj: string;
let userBase: string;
let projPlugins: string;
let userPlugins: string;

beforeEach(() => {
	proj = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-'));
	userBase = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-user-'));
	projPlugins = path.join(proj, '.wraith', 'plugins');
	userPlugins = path.join(userBase, '.wraith', 'plugins');
});

afterEach(() => {
	try {
		fs.rmSync(proj, { recursive: true, force: true });
	} catch {
		//
	}
	try {
		fs.rmSync(userBase, { recursive: true, force: true });
	} catch {
		//
	}
});

function writeEchoPlugin(root: string, name = 'echo') {
	const dir = path.join(root, name);
	write(
		path.join(dir, 'plugin.json'),
		JSON.stringify(
			{
				name,
				version: '0.1.0',
				main: 'index.js',
				permissions: [],
			},
			null,
			2
		)
	);
	write(
		path.join(dir, 'index.js'),
		`
export function register(reg) {
  reg.register({
    name: 'echo.say',
    title: 'Echo say',
    description: 'Echo back text',
    requiredPermissions: [],
    paramsSchema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] }
  }, (params) => {
    return { text: params.text };
  });
}
`
	);
}

function writeNetPlugin(root: string, name = 'netplug') {
	const dir = path.join(root, name);
	write(
		path.join(dir, 'plugin.yaml'),
		`
name: ${name}
version: "0.1.0"
main: index.js
permissions:
  - net
`
	);
	write(
		path.join(dir, 'index.js'),
		`
export function register(reg) {
  reg.register({
    name: 'net.echo',
    title: 'Net Echo',
    description: 'Requires net permission',
    requiredPermissions: ['net'],
    paramsSchema: { type: 'object', additionalProperties: false, properties: { s: { type: 'string' } }, required: ['s'] }
  }, (params) => ({ s: params.s }));
}
`
	);
}

describe('plugin discovery', () => {
	it('loads project plugin, registers its tool, and runs it', async () => {
		writeEchoPlugin(projPlugins, 'echo');
		const reg = new ToolRegistry();
		const { loaded } = await discoverAndRegisterPlugins(reg, {
			projectPluginsDir: projPlugins,
			userPluginsDir: userPlugins,
			projectDir: proj,
			enforcePermissions: true,
			policy: { allowPermissions: [] },
		});
		expect(loaded.length).toBe(1);
		expect(loaded[0]?.registered).toBe(true);

		const res = await reg.run<{ text: string }>(
			'echo.say',
			{ text: 'hi' },
			ctx(proj)
		);
		expect(res.text).toBe('hi');
	});

	it('project plugin takes precedence over user plugin with the same name', async () => {
		writeEchoPlugin(userPlugins, 'dupe');
		// project one will be seen first and win
		writeEchoPlugin(projPlugins, 'dupe');

		const reg = new ToolRegistry();
		const { loaded } = await discoverAndRegisterPlugins(reg, {
			projectPluginsDir: projPlugins,
			userPluginsDir: userPlugins,
			projectDir: proj,
			enforcePermissions: true,
			policy: { allowPermissions: [] },
		});
		const names = loaded.map((l) => `${l.source}:${l.name}`);
		// should have only the project copy registered; the user one is skipped
		expect(names.filter((x) => x.includes(':dupe')).length).toBe(1);
		expect(names[0]?.startsWith('project:')).toBe(true);
	});

	it('enforces plugin permissions at load time when requested', async () => {
		writeNetPlugin(projPlugins, 'netplug');
		const reg = new ToolRegistry();
		await expect(
			discoverAndRegisterPlugins(reg, {
				projectPluginsDir: projPlugins,
				userPluginsDir: userPlugins,
				projectDir: proj,
				enforcePermissions: true,
				policy: { allowPermissions: [] }, // deny net
			})
		).rejects.toBeInstanceOf(ToolPermissionError);
	});

	it('when not enforcing at load time, tools are still gated at call time', async () => {
		writeNetPlugin(projPlugins, 'netplug');
		const reg = new ToolRegistry();
		await discoverAndRegisterPlugins(reg, {
			projectPluginsDir: projPlugins,
			userPluginsDir: userPlugins,
			projectDir: proj,
			enforcePermissions: false,
			policy: { allowPermissions: [] },
		});

		// Running without 'net' permission should be denied by the registry
		await expect(
			reg.run('net.echo', { s: 'x' }, ctx(proj, []))
		).rejects.toBeInstanceOf(Error);
	});
});
