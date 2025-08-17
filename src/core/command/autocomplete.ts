import type { CommandRegistry } from './registry.js';
import type { ArgumentSpec, CommandSpec } from './types.js';

export type SuggestionKind = 'command' | 'argument' | 'entity';

export interface Suggestion {
	label: string;
	detail?: string;
	kind: SuggestionKind;
	score: number;
}

export interface ArgProviderCtx {
	command: CommandSpec;
	argIndex: number;
	prefix: string;
}

export type ArgumentValuesProvider = (
	ctx: ArgProviderCtx
) => Promise<string[]> | string[];

export interface AutocompleteOptions {
	argumentValues?: ArgumentValuesProvider;
}

type WithOrder<T> = T & { __order: number };

function byScoreWithOrder<
	T extends { score: number; label: string; __order: number },
>(a: T, b: T): number {
	if (a.score !== b.score) {
		return b.score - a.score;
	}
	if (a.__order !== b.__order) {
		return a.__order - b.__order;
	}
	return a.label.localeCompare(b.label);
}

function scoreCandidate(candidate: string, prefix: string): number {
	if (!prefix) {
		return 1; // neutral score when no prefix
	}
	const lc = candidate.toLowerCase();
	const lp = prefix.toLowerCase();
	if (lc.startsWith(lp)) {
		return 3; // strongest
	}
	if (lc.includes(lp)) {
		return 1; // weak fuzzy
	}
	return Number.NEGATIVE_INFINITY; // filtered out
}

function tolerantTokens(input: string): {
	tokens: string[];
	endsWithSpace: boolean;
} {
	const endsWithSpace = /\s$/.test(input);
	const trimmed = input.trimStart();
	const body = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
	const tokens = body.split(/\s+/).filter((t) => t.length > 0);
	return { tokens, endsWithSpace };
}

export async function suggest(
	line: string,
	registry: CommandRegistry,
	opts: AutocompleteOptions = {}
): Promise<Suggestion[]> {
	const { tokens, endsWithSpace } = tolerantTokens(line);

	// No tokens → suggest commands
	if (tokens.length === 0) {
		return suggestCommands('', registry);
	}

	const [first, ...rest] = tokens;

	// If typing the command id (no space yet)
	if (!endsWithSpace && tokens.length === 1) {
		return suggestCommands(first, registry);
	}

	// Otherwise, we are on arguments for a (possibly) known command
	const cmd = registry.get(first);
	if (!cmd) {
		// unknown command; fallback to command suggestions
		return suggestCommands(first, registry);
	}

	const argIndex = endsWithSpace ? rest.length : Math.max(0, rest.length - 1);
	const prefix = endsWithSpace ? '' : (rest.at(-1) ?? '');
	const spec = (cmd.args ?? [])[argIndex] as ArgumentSpec | undefined;
	if (!spec) {
		return [];
	}

	// Enum options take precedence
	if (spec.type === 'enum' && spec.options && spec.options.length) {
		const items = spec.options
			.map((opt, i) => ({
				label: opt,
				kind: 'argument' as const,
				score: scoreCandidate(opt, prefix),
				__order: i,
			}))
			.filter((s) => s.score !== Number.NEGATIVE_INFINITY)
			.sort(byScoreWithOrder);
		return items.map(({ __order: _o, ...rested }) => rested);
	}

	// Entity / free-text suggestions via provider
	const provided: string[] =
		(await opts.argumentValues?.({ command: cmd, argIndex, prefix })) ?? [];
	const mapped = provided
		.map((v, i) => ({
			label: v,
			kind: 'entity' as const,
			score: scoreCandidate(v, prefix),
			__order: i,
		}))
		.filter((s) => s.score !== Number.NEGATIVE_INFINITY)
		.sort(byScoreWithOrder)
		.map(({ __order: _o, ...rested }) => rested);
	// If nothing from provider, consider placeholder with arg name
	if (mapped.length === 0 && spec.name) {
		return [
			{
				label: `<${spec.name}>`,
				detail: 'argument',
				kind: 'argument',
				score: 0,
			},
		];
	}
	return mapped;
}

function suggestCommands(
	prefix: string,
	registry: CommandRegistry
): Suggestion[] {
	const all = registry.list();
	const seen = new Set<string>();
	const items: WithOrder<Suggestion>[] = [];
	all.forEach((cmd, cmdOrder) => {
		const ids = [cmd.id, ...(cmd.aliases ?? [])];
		for (let aliasOrder = 0; aliasOrder < ids.length; aliasOrder++) {
			const id = ids[aliasOrder];
			if (seen.has(id)) {
				continue;
			}
			const score = scoreCandidate(id, prefix);
			if (score === Number.NEGATIVE_INFINITY) {
				continue;
			}
			items.push({
				label: id,
				detail: cmd.synopsis,
				kind: 'command',
				score,
				__order: cmdOrder * 100 + aliasOrder,
			});
			seen.add(id);
		}
	});
	return items.sort(byScoreWithOrder).map(({ __order: _o, ...rest }) => rest);
}
