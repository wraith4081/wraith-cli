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

function toSet<T extends string>(arr?: T[]): Set<T> {
	return new Set(arr ?? []);
}

function hasIntersection<T>(a: Set<T>, b: Set<T>): boolean {
	for (const x of a) {
		if (b.has(x)) {
			return true;
		}
	}
	return false;
}

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

	private ensureAllowed(
		name: string,
		spec: ToolSpec,
		policy: ToolPolicy
	): void {
		const allowList = toSet(policy.allowedTools);
		const denyList = toSet(policy.deniedTools);
		if (denyList.has(name)) {
			throw new ToolPermissionError(
				name,
				'tool is explicitly denied by policy'
			);
		}
		if (allowList.size > 0 && !allowList.has(name)) {
			throw new ToolPermissionError(name, 'tool is not in allowedTools');
		}

		const required = toSet(
			spec.requiredPermissions as Permission[] | undefined
		);
		if (required.size === 0) {
			return;
		}

		const denies = toSet(
			policy.denyPermissions as Permission[] | undefined
		);
		if (hasIntersection(required, denies)) {
			throw new ToolPermissionError(
				name,
				`requires denied permission(s): ${Array.from(required)
					.filter((p) => denies.has(p))
					.join(', ')}`
			);
		}

		const allows = toSet(
			policy.allowPermissions as Permission[] | undefined
		);
		if (allows.size > 0) {
			for (const p of required) {
				if (!allows.has(p)) {
					throw new ToolPermissionError(
						name,
						`missing required permission '${p}' in allowPermissions`
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
