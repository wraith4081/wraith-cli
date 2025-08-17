import type { ArgumentValuesProvider } from './autocomplete.js';

export interface CacheOptions {
	ttlMs?: number;
	maxSize?: number;
}

function makeKey(id: string, argIndex: number, prefix: string) {
	return `${id}#${argIndex}#${prefix.toLowerCase()}`;
}

export function cachedProvider(
	base: ArgumentValuesProvider,
	opts: CacheOptions = {}
): ArgumentValuesProvider {
	const ttl = opts.ttlMs ?? 5000;
	const max = opts.maxSize ?? 200;
	const store = new Map<string, { at: number; value: string[] }>();

	function evictIfNeeded() {
		if (store.size <= max) {
			return;
		}
		// evict oldest entries until under limit
		const remove = store.size - max;
		let i = 0;
		for (const k of store.keys()) {
			store.delete(k);
			if (++i >= remove) {
				break;
			}
		}
	}

	return async ({ command, argIndex, prefix }) => {
		const key = makeKey(command.id, argIndex, prefix);
		const now = Date.now();
		const hit = store.get(key);
		if (hit && now - hit.at <= ttl) {
			return hit.value;
		}
		const value = await base({ command, argIndex, prefix });
		store.set(key, { at: now, value });
		evictIfNeeded();
		return value;
	};
}

export function coalescedProvider(
	base: ArgumentValuesProvider
): ArgumentValuesProvider {
	const pending = new Map<string, Promise<string[]>>();
	return ({ command, argIndex, prefix }) => {
		const key = makeKey(command.id, argIndex, prefix);
		const cur = pending.get(key);
		if (cur) {
			return cur;
		}
		const p = Promise.resolve(base({ command, argIndex, prefix })).finally(
			() => pending.delete(key)
		);
		pending.set(key, p);
		return p;
	};
}

export function withPerfGuards(
	base: ArgumentValuesProvider,
	options: CacheOptions = {}
): ArgumentValuesProvider {
	return cachedProvider(coalescedProvider(base), options);
}
