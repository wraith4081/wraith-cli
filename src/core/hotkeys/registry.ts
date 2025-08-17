import {
	type KeyEventLike,
	matchEvent,
	type NormalizedChord,
	normalizeChord,
	type Platform,
} from './types.js';

export interface Hotkey {
	id: string; // action id
	chord: string; // original chord string
}

type Handler = () => void | Promise<void>;

export class HotkeyManager {
	private platform: Platform;
	private byId = new Map<string, { chord: string; handler: Handler }>();
	private byKey = new Map<string, string>(); // normalized key -> id

	constructor(platform: Platform = 'win32') {
		this.platform = platform;
	}

	list(): Hotkey[] {
		return Array.from(this.byId.entries()).map(([id, { chord }]) => ({
			id,
			chord,
		}));
	}

	getNormalizedKey(chord: string): string {
		const n = normalizeChord(chord, this.platform);
		return HotkeyManager.keyToString(n);
	}

	static keyToString(n: NormalizedChord): string {
		return `${n.modifiers.join('+')}+${n.key}`;
	}

	register(id: string, chord: string, handler: Handler): void {
		if (this.byId.has(id)) {
			throw new Error(`Hotkey id '${id}' already registered`);
		}
		const key = this.getNormalizedKey(chord);
		if (this.byKey.has(key)) {
			throw new Error(
				`Chord '${chord}' conflicts with '${this.byKey.get(key)}'`
			);
		}
		this.byId.set(id, { chord, handler });
		this.byKey.set(key, id);
	}

	remap(id: string, chord: string): void {
		const cur = this.byId.get(id);
		if (!cur) {
			throw new Error(`Unknown hotkey id '${id}'`);
		}
		const oldKey = this.getNormalizedKey(cur.chord);
		const newKey = this.getNormalizedKey(chord);
		if (oldKey === newKey) {
			return; // no change
		}
		if (this.byKey.has(newKey)) {
			throw new Error(
				`Chord '${chord}' conflicts with '${this.byKey.get(newKey)}'`
			);
		}
		this.byKey.delete(oldKey);
		this.byKey.set(newKey, id);
		cur.chord = chord;
	}

	unregister(id: string): void {
		const cur = this.byId.get(id);
		if (!cur) {
			return;
		}
		const key = this.getNormalizedKey(cur.chord);
		this.byId.delete(id);
		this.byKey.delete(key);
	}

	async handle(ev: KeyEventLike): Promise<boolean> {
		// Scan registry for a match (small size expected)
		for (const [_id, { chord, handler }] of this.byId.entries()) {
			const n = normalizeChord(chord, this.platform);
			if (matchEvent(ev, n)) {
				await handler();
				return true;
			}
		}
		return false;
	}
}
