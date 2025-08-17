export type Modifier = 'Ctrl' | 'Alt' | 'Shift' | 'Meta' | 'Mod';

export interface KeyEventLike {
	key: string; // e.g., 'k', 'P'
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	metaKey?: boolean;
}

export interface NormalizedChord {
	key: string; // upper-case base key
	modifiers: Exclude<Modifier, 'Mod'>[]; // concrete modifiers, sorted
}

export type Platform = 'darwin' | 'win32' | 'linux';

export function normalizeChord(
	chord: string,
	platform: Platform = 'win32'
): NormalizedChord {
	const parts = chord
		.split('+')
		.map((p) => p.trim())
		.filter(Boolean);
	const mods: string[] = [];
	let base = '';
	for (const p of parts) {
		const up = p.toUpperCase();
		if (['CTRL', 'CONTROL'].includes(up)) {
			mods.push('Ctrl');
		} else if (['ALT', 'OPTION'].includes(up)) {
			mods.push('Alt');
		} else if (['SHIFT'].includes(up)) {
			mods.push('Shift');
		} else if (['CMD', 'COMMAND', 'META'].includes(up)) {
			mods.push('Meta');
		} else if (['MOD', 'CMDRL'].includes(up)) {
			mods.push('Mod');
		} else {
			base = up.length === 1 ? up : up; // accept non-letter keys as-is
		}
	}
	// resolve Mod to platform-specific
	const resolved: Exclude<Modifier, 'Mod'>[] = mods
		.map((m) =>
			m === 'Mod'
				? platform === 'darwin'
					? 'Meta'
					: 'Ctrl'
				: (m as Exclude<Modifier, 'Mod'>)
		)
		.sort();
	return { key: base || '', modifiers: resolved };
}

export function matchEvent(ev: KeyEventLike, chord: NormalizedChord): boolean {
	const key = (ev.key || '').toUpperCase();
	const set = new Set<Exclude<Modifier, 'Mod'>>();
	if (ev.ctrlKey) {
		set.add('Ctrl');
	}
	if (ev.altKey) {
		set.add('Alt');
	}
	if (ev.shiftKey) {
		set.add('Shift');
	}
	if (ev.metaKey) {
		set.add('Meta');
	}
	if (key !== chord.key) {
		return false;
	}
	if (set.size !== chord.modifiers.length) {
		return false;
	}
	for (const m of chord.modifiers) {
		if (!set.has(m)) {
			return false;
		}
	}
	return true;
}
