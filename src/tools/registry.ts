import {
	ToolError,
	ToolExecutionError,
	ToolNotFoundError,
	ToolPermissionError,
	ToolValidationError,
} from '@tools/errors';
import type {
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

	private ensureAllowed(name: string, spec: ToolSpec, policy?: ToolPolicy) {
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

		if (policy?.allowPermissions) {
			const allowPerms = new Set(policy.allowPermissions);
			for (const p of req) {
				if (!allowPerms.has(p)) {
					throw new ToolPermissionError(
						name,
						`Permission not granted: ${p}`
					);
				}
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
		this.ensureAllowed(name, reg.spec, ctx.policy);
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
