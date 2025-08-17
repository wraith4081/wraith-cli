import {
	CommandError,
	type CommandRegistryAPI,
	type CommandSpec,
} from './types.js';

export class CommandRegistry<Ctx = unknown, Res = unknown>
	implements CommandRegistryAPI<Ctx, Res>
{
	private readonly byId = new Map<string, CommandSpec<Ctx, Res>>();
	private readonly alias = new Map<string, string>();

	register(spec: CommandSpec<Ctx, Res>): void {
		const id = spec.id.trim();
		if (!id) {
			throw new CommandError('EID', 'Command id must be non-empty');
		}
		if (this.byId.has(id)) {
			throw new CommandError(
				'EDUP',
				`Command '${id}' already registered`
			);
		}
		this.byId.set(id, spec);
		for (const a of spec.aliases ?? []) {
			const key = a.trim();
			if (this.alias.has(key) || this.byId.has(key)) {
				throw new CommandError(
					'EALIAS',
					`Alias '${key}' for '${id}' conflicts with existing id/alias`
				);
			}
			this.alias.set(key, id);
		}
	}

	get(idOrAlias: string): CommandSpec<Ctx, Res> | undefined {
		const id = this.alias.get(idOrAlias) ?? idOrAlias;
		return this.byId.get(id);
	}

	list(): CommandSpec<Ctx, Res>[] {
		return Array.from(this.byId.values());
	}

	async execute(idOrAlias: string, argv: string[], ctx: Ctx): Promise<Res> {
		const spec = this.get(idOrAlias);
		if (!spec) {
			throw new CommandError(
				'ENOTFOUND',
				`Command '${idOrAlias}' not found`
			);
		}
		// Basic arity/validation according to spec.args
		const defs = spec.args ?? [];

		// Check required count
		const required = defs.filter((d) => d.required).length;
		if (argv.length < required) {
			throw new CommandError(
				'EARGS',
				`Missing required argument(s). Expected at least ${required}, got ${argv.length}`
			);
		}

		// Validate enum/options and custom validators
		defs.forEach((d, i) => {
			const v = argv[i];
			if (d.required && (v === undefined || v === '')) {
				throw new CommandError(
					'EARG',
					`Argument '${d.name}' is required`
				);
			}
			if (v === undefined) {
				return; // optional not provided
			}
			if (d.type === 'enum' && d.options && !d.options.includes(v)) {
				throw new CommandError(
					'EARG',
					`Argument '${d.name}' must be one of: ${d.options.join(', ')}`
				);
			}
			const msg = d.validate?.(v);
			if (msg) {
				throw new CommandError('EARG', msg);
			}
		});

		const res = await spec.handler(argv, ctx);
		return res as Res;
	}
}
