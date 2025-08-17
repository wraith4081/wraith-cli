import type { CommandRegistry } from './registry.js';
import type { CommandSpec } from './types.js';

function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () =>
		new Array(n + 1).fill(0)
	);
	for (let i = 0; i <= m; i++) {
		dp[i][0] = i;
	}
	for (let j = 0; j <= n; j++) {
		dp[0][j] = j;
	}
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1, // deletion
				dp[i][j - 1] + 1, // insertion
				dp[i - 1][j - 1] + cost // substitution
			);
		}
	}
	return dp[m][n];
}

export function closestCommandIds(
	registry: CommandRegistry,
	target: string,
	limit = 3
): string[] {
	const list = registry.list();
	// Collect ids and aliases
	const entries: { key: string; id: string; spec: CommandSpec }[] = [];
	for (const spec of list) {
		entries.push({ key: spec.id, id: spec.id, spec });
		for (const a of spec.aliases ?? []) {
			entries.push({ key: a, id: spec.id, spec });
		}
	}
	const scored = entries
		.map((e) => ({
			e,
			d: levenshtein(e.key.toLowerCase(), target.toLowerCase()),
		}))
		.sort((x, y) => x.d - y.d);
	const out: string[] = [];
	for (const s of scored) {
		if (!out.includes(s.e.id)) {
			out.push(s.e.id);
		}
		if (out.length >= limit) {
			break;
		}
	}
	return out;
}

export function formatNotFoundMessage(
	registry: CommandRegistry,
	id: string
): string {
	const suggestions = closestCommandIds(registry, id, 3);
	const hint = suggestions.length
		? ` Did you mean: ${suggestions.map((s) => `/${s}`).join(', ')}?`
		: '';
	return `Command '${id}' not found.${hint}`;
}
