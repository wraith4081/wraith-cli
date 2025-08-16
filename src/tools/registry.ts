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
	) {
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

		// Permissions satisfied?
		const allowPermsArr = policy?.allowPermissions ?? [];
		const allowPerms = new Set<Permission>(allowPermsArr);

		const missing: Permission[] = [];
		for (const p of req) {
			if (!allowPerms.has(p)) {
				missing.push(p);
			}
		}
		if (missing.length === 0) {
			return; // all good
		}

		// If allowPermissions is omitted entirely, historical behavior was "allow unless denied".
		// We already treated omitted as [] above to compute missing; only prompt when explicitly configured.
		if (policy?.onMissingPermission !== 'prompt') {
			// Deny on first missing to provide a precise error.
			throw new ToolPermissionError(
				name,
				`Permission not granted: ${missing[0] as string}`
			);
		}

		// Prompt path: ask once per missing permission.
		for (const p of missing) {
			const ok = await Promise.resolve(
				ctx.ask?.({
					kind: 'confirm',
					title: 'Permission Request',
					message: `Tool "${name}" requires permission "${p}". Allow for this run?`,
					defaultYes: false,
					context: { tool: name, permission: p },
				}) ?? false
			);
			if (!ok) {
				throw new ToolPermissionError(
					name,
					`Permission not granted: ${p}`
				);
			}
			// Cache one-time allow to avoid re-prompting later in this process.
			if (Array.isArray(ctx.policy.allowPermissions)) {
				if (!ctx.policy.allowPermissions.includes(p)) {
					ctx.policy.allowPermissions.push(p);
				}
			} else {
				ctx.policy.allowPermissions = [p];
			}
		}
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
			const res = await reg.handler(params, ctx);
			return res as T;
		} catch (e) {
			if (e instanceof ToolError) {
				throw e;
			}

			throw new ToolExecutionError(name, e);
		}
	}
}
