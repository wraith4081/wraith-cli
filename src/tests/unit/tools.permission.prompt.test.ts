import { ToolPermissionError } from '@tools/errors';
import { ToolRegistry } from '@tools/registry';
import type { Permission, ToolContext, ToolSpec } from '@tools/types';
import { describe, expect, it, vi } from 'vitest';

function makeCtx(
	policy?: Partial<ToolContext['policy']>,
	ask?: ToolContext['ask']
): ToolContext {
	return {
		cwd: process.cwd(),
		policy: {
			allowedTools: policy?.allowedTools,
			deniedTools: policy?.deniedTools,
			allowPermissions: policy?.allowPermissions,
			denyPermissions: policy?.denyPermissions,
			onMissingPermission: policy?.onMissingPermission,
		},
		ask,
	};
}

describe('permission model: onMissingPermission=prompt', () => {
	it('prompts once, allows on yes, and caches the permission', async () => {
		const reg = new ToolRegistry();

		const spec: ToolSpec = {
			name: 'demo.op',
			requiredPermissions: ['net'],
		};
		const handler = vi.fn().mockReturnValue('ok');

		reg.register(spec, handler);

		const ask = vi
			.fn<Parameters<NonNullable<ToolContext['ask']>>, boolean>()
			.mockReturnValue(true);

		const ctx = makeCtx(
			{
				// intentionally *not* granting 'net' up front
				allowPermissions: [],
				onMissingPermission: 'prompt',
			},
			ask
		);

		// First run: should prompt and then succeed.
		const out1 = await reg.run('demo.op', {}, ctx);
		expect(out1).toBe('ok');
		expect(handler).toHaveBeenCalledTimes(1);
		expect(ask).toHaveBeenCalledTimes(1);
		// The registry should have cached the granted permission.
		expect(ctx.policy.allowPermissions).toContain<'net'>(
			'net' as Permission
		);

		// Second run: should *not* prompt again.
		const out2 = await reg.run('demo.op', {}, ctx);
		expect(out2).toBe('ok');
		expect(handler).toHaveBeenCalledTimes(2);
		expect(ask).toHaveBeenCalledTimes(1);
	});

	it('denies when user answers no to the prompt', async () => {
		const reg = new ToolRegistry();

		const spec: ToolSpec = {
			name: 'demo.no',
			requiredPermissions: ['shell'],
		};
		reg.register(spec, () => 'never');

		const ask = vi
			.fn<Parameters<NonNullable<ToolContext['ask']>>, boolean>()
			.mockReturnValue(false);

		const ctx = makeCtx(
			{
				allowPermissions: [],
				onMissingPermission: 'prompt',
			},
			ask
		);

		await expect(reg.run('demo.no', {}, ctx)).rejects.toBeInstanceOf(
			ToolPermissionError
		);
		expect(ask).toHaveBeenCalledTimes(1);
		// Should not have cached a permission on denial.
		expect(ctx.policy.allowPermissions).not.toContain('shell');
	});

	it('does not prompt when permission already granted', async () => {
		const reg = new ToolRegistry();

		const spec: ToolSpec = {
			name: 'demo.granted',
			requiredPermissions: ['fs'],
		};
		const handler = vi.fn().mockReturnValue('ok');
		reg.register(spec, handler);

		const ask = vi.fn().mockReturnValue(true); // should never be called
		const ctx = makeCtx(
			{
				allowPermissions: ['fs'],
				onMissingPermission: 'prompt',
			},
			ask
		);

		const out = await reg.run('demo.granted', {}, ctx);
		expect(out).toBe('ok');
		expect(handler).toHaveBeenCalledTimes(1);
		expect(ask).not.toHaveBeenCalled();
	});

	it('denies without prompting when onMissingPermission=deny', async () => {
		const reg = new ToolRegistry();

		const spec: ToolSpec = {
			name: 'demo.deny',
			requiredPermissions: ['net'],
		};
		reg.register(spec, () => 'nope');

		const ask = vi.fn().mockReturnValue(true); // should not be called
		const ctx = makeCtx(
			{
				allowPermissions: [],
				onMissingPermission: 'deny',
			},
			ask
		);

		await expect(reg.run('demo.deny', {}, ctx)).rejects.toBeInstanceOf(
			ToolPermissionError
		);
		expect(ask).not.toHaveBeenCalled();
	});
});
