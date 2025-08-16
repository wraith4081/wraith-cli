import { recordTool } from '@obs/metrics';
import {
	ToolError,
	ToolExecutionError,
	ToolNotFoundError,
	ToolPermissionError,
	ToolValidationError,
} from '@tools/errors';
import type {
	Permission,
	RegisteredTool,
	ToolContext,
	ToolHandler,
	ToolPolicy,
	ToolSpec,
} from '@tools/types';
import type { AjvLike } from '@tools/validator';
import { formatAjvErrors, makeAjv } from '@tools/validator';

type ValidatorFn = (data: unknown) => boolean;

export class ToolRegistry {
	private readonly ajv: AjvLike;
	private readonly tools = new Map<string, RegisteredTool>();
	private readonly validators = new Map<string, ValidatorFn>();

	constructor(ajv?: AjvLike) {
		this.ajv = ajv ?? makeAjv();
	}

	register(spec: ToolSpec, handler: ToolHandler): void {
		if (!spec?.name || typeof spec.name !== 'string') {
			throw new Error('Tool spec must include a non-empty name');
		}
		if (this.tools.has(spec.name)) {
			throw new Error(`Tool already registered: ${spec.name}`);
		}
		this.tools.set(spec.name, { spec, handler });
		if (spec.paramsSchema) {
			const validate = this.ajv.compile(spec.paramsSchema);
			this.validators.set(spec.name, validate);
		}
	}

	list(): ToolSpec[] {
		return Array.from(this.tools.values()).map((t) => t.spec);
	}

	get(name: string): RegisteredTool {
		const t = this.tools.get(name);
		if (!t) {
			throw new ToolNotFoundError(name);
		}
		return t;
	}

	private async ensureAllowed(
		name: string,
		spec: ToolSpec,
		ctx: ToolContext
	): Promise<void> {
		const policy: ToolPolicy | undefined = ctx.policy;
		const deniedTools = new Set(policy?.deniedTools ?? []);
		if (deniedTools.has(name)) {
			throw new ToolPermissionError(
				name,
				`Tool denied by policy: ${name}`
			);
		}

		if (policy?.allowedTools) {
			const allowedTools = new Set(policy.allowedTools);
			if (!allowedTools.has(name)) {
				throw new ToolPermissionError(
					name,
					`Tool not allowed by policy: ${name}`
				);
			}
		}

		const req = new Set(spec.requiredPermissions ?? []);
		const denyPerms = new Set(policy?.denyPermissions ?? []);
		for (const p of req) {
			if (denyPerms.has(p)) {
				throw new ToolPermissionError(name, `Permission denied: ${p}`);
			}
		}

		// Effective allow-list (empty if not provided)
		const allowPerms = new Set<Permission>(policy?.allowPermissions ?? []);

		// Fast path: allow all if explicitly configured so.
		const mode = policy?.onMissingPermission ?? 'deny';
		if (mode === 'allow') {
			return;
		}

		// For each required permission, ensure it's granted or handle the miss.
		const missing: Permission[] = [];
		for (const p of req) {
			if (!allowPerms.has(p)) {
				missing.push(p);
			}
		}
		if (missing.length === 0) {
			return;
		}

		if (mode === 'deny' || !ctx.ask) {
			// No prompting available or explicitly denied.
			const which = missing.join(', ');
			throw new ToolPermissionError(
				name,
				`Permission not granted: ${which}`
			);
		}

		// Prompt once for all missing permissions for this tool.
		const approved = await Promise.resolve(
			ctx.ask({
				type: 'permission',
				tool: name,
				permissions: missing,
				reason:
					missing.length === 1
						? `Tool requires "${missing[0]}" permission`
						: `Tool requires permissions: ${missing.join(', ')}`,
			})
		);

		if (!approved) {
			throw new ToolPermissionError(
				name,
				`User denied permission${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
			);
		}

		// Cache the grant by mutating the allow list in the active policy.
		const updated = new Set<Permission>(policy?.allowPermissions ?? []);
		for (const p of missing) {
			updated.add(p);
		}
		ctx.policy.allowPermissions = [...updated];
	}

	private validateParams(name: string, params: unknown): void {
		const validate = this.validators.get(name);
		if (!validate) {
			return; // no schema => nothing to validate
		}
		const ok = validate(params);
		if (!ok) {
			const issues = formatAjvErrors(
				(validate as unknown as { errors?: unknown })
					.errors as unknown[] as never
			);
			throw new ToolValidationError(name, issues);
		}
	}

	async run<T = unknown>(
		name: string,
		params: unknown,
		ctx: ToolContext
	): Promise<T> {
		const reg = this.get(name);
		await this.ensureAllowed(name, reg.spec, ctx);
		this.validateParams(name, params);

		try {
			const t0 = Date.now();
			const res = await reg.handler(params, ctx);
			try {
				recordTool(
					{
						name,
						elapsedMs: Date.now() - t0,
						ok: true,
					},
					ctx.cwd
				);
			} catch {
				// ignore
			}
			return res as T;
		} catch (e) {
			try {
				recordTool(
					{
						name,
						elapsedMs: 0,
						ok: false,
						error: e instanceof Error ? e.message : String(e),
					},
					ctx.cwd
				);
			} catch {
				// ignore
			}
			if (e instanceof ToolError) {
				throw e;
			}
			throw new ToolExecutionError(name, e);
		}
	}
}
