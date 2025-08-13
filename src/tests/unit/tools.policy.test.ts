import { ToolPermissionError } from '@tools/errors';
import { ToolRegistry } from '@tools/registry';
import type { ToolContext, ToolSpec } from '@tools/types';
import { describe, expect, it } from 'vitest';

function ctx(policy?: Partial<ToolContext['policy']>): ToolContext {
	return {
		cwd: process.cwd(),
		policy: {
			allowedTools: policy?.allowedTools,
			deniedTools: policy?.deniedTools,
			allowPermissions: policy?.allowPermissions,
			denyPermissions: policy?.denyPermissions,
		},
	};
}

describe('policy precedence', () => {
	it('deniedTools takes precedence over allowedTools', async () => {
		const reg = new ToolRegistry();
		const spec: ToolSpec = { name: 'fs.read', requiredPermissions: ['fs'] };
		reg.register(spec, () => 'ok');

		await expect(
			reg.run(
				'fs.read',
				{},
				ctx({
					allowedTools: ['fs.read'],
					deniedTools: ['fs.read'],
					allowPermissions: ['fs'],
				})
			)
		).rejects.toBeInstanceOf(ToolPermissionError);
	});

	it('denyPermissions blocks even when allowedTools includes the tool', async () => {
		const reg = new ToolRegistry();
		reg.register(
			{ name: 'shell.exec', requiredPermissions: ['shell'] },
			() => 'ran'
		);

		await expect(
			reg.run(
				'shell.exec',
				{},
				ctx({
					allowedTools: ['shell.exec'],
					allowPermissions: ['shell'],
					denyPermissions: ['shell'],
				})
			)
		).rejects.toBeInstanceOf(ToolPermissionError);
	});
});
