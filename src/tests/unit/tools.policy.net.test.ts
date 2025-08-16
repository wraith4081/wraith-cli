import { ToolPermissionError } from '@tools/errors';
import { ToolRegistry } from '@tools/registry';
import type { Permission, ToolContext, ToolSpec } from '@tools/types';
import { describe, expect, it } from 'vitest';

function makeCtx(
	policy: Partial<ToolContext['policy']> & {
		onMissingPermission?: 'prompt' | 'deny' | 'allow';
	} = {}
): ToolContext {
	return {
		cwd: process.cwd(),
		policy: {
			allowedTools: policy.allowedTools,
			deniedTools: policy.deniedTools,
			allowPermissions: policy.allowPermissions as
				| Permission[]
				| undefined,
			denyPermissions: policy.denyPermissions as Permission[] | undefined,
			onMissingPermission: policy.onMissingPermission ?? 'deny',
		},
	};
}

describe('ToolRegistry permission gating / net policy', () => {
	it('denies by default when permission is missing (no onMissingPermission set)', async () => {
		const reg = new ToolRegistry();
		const spec: ToolSpec = {
			name: 'web.fetch',
			requiredPermissions: ['net'],
		};
		reg.register(spec, () => 'ok');

		const ctx = makeCtx({
			/* default deny */
		});
		await expect(reg.run('web.fetch', {}, ctx)).rejects.toBeInstanceOf(
			ToolPermissionError
		);
	});

	it('allows when onMissingPermission=allow', async () => {
		const reg = new ToolRegistry();
		reg.register(
			{ name: 'net.tool', requiredPermissions: ['net'] },
			() => 'ran'
		);

		const ctx = makeCtx({ onMissingPermission: 'allow' });
		await expect(reg.run('net.tool', {}, ctx)).resolves.toBe('ran');
	});

	it('prompts when onMissingPermission=prompt and grants on approval; caches grant', async () => {
		const reg = new ToolRegistry();
		reg.register({ name: 't1', requiredPermissions: ['net'] }, () => 'ok1');
		reg.register({ name: 't2', requiredPermissions: ['net'] }, () => 'ok2');

		let asks = 0;
		const ctx: ToolContext = {
			cwd: process.cwd(),
			policy: { onMissingPermission: 'prompt', allowPermissions: [] },
			ask: (q) => {
				asks++;
				expect(q.type).toBe('permission');
				expect(q.tool === 't1' || q.tool === 't2').toBe(true);
				expect(q.permissions).toEqual(['net']);
				return true; // approve
			},
		};

		// First run should prompt and then succeed
		await expect(reg.run('t1', {}, ctx)).resolves.toBe('ok1');
		expect(asks).toBe(1);
		// Policy should now include the granted 'net'
		expect(new Set(ctx.policy.allowPermissions)).toContain('net');

		// Second run should NOT prompt again (grant cached)
		await expect(reg.run('t2', {}, ctx)).resolves.toBe('ok2');
		expect(asks).toBe(1);
	});

	it('prompts and denies when user rejects', async () => {
		const reg = new ToolRegistry();
		reg.register(
			{ name: 't3', requiredPermissions: ['net'] },
			() => 'nope'
		);

		const ctx: ToolContext = {
			cwd: process.cwd(),
			policy: { onMissingPermission: 'prompt', allowPermissions: [] },
			ask: () => false, // user declines
		};

		await expect(reg.run('t3', {}, ctx)).rejects.toBeInstanceOf(
			ToolPermissionError
		);
		// Ensure we did not cache any grant
		expect(ctx.policy.allowPermissions?.includes('net')).toBeFalsy();
	});
});
