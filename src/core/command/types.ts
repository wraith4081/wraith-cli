export type CommandArgType = 'string' | 'enum' | 'entity';

export interface ArgumentSpec {
	name: string;
	type?: CommandArgType;
	required?: boolean;
	// For enum types
	options?: string[];
	// Custom validator returns an error message string if invalid
	validate?: (value: string) => string | undefined;
}

export interface CommandSpec<Ctx = unknown, Res = unknown> {
	id: string;
	aliases?: string[];
	synopsis?: string;
	args?: ArgumentSpec[];
	handler: (argv: string[], ctx: Ctx) => Promise<Res> | Res;
}

export class CommandError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = 'CommandError';
		this.code = code;
	}
}

export interface ParsedCommand {
	id: string;
	argv: string[];
}

export interface CommandRegistryAPI<Ctx = unknown, Res = unknown> {
	register: (spec: CommandSpec<Ctx, Res>) => void;
	get: (idOrAlias: string) => CommandSpec<Ctx, Res> | undefined;
	list: () => CommandSpec<Ctx, Res>[];
	execute: (idOrAlias: string, argv: string[], ctx: Ctx) => Promise<Res>;
}
