export type Priority = 'polite' | 'assertive';

export interface Announcer {
	announce(message: string, priority?: Priority): void;
	getLast(): { message: string; priority: Priority } | undefined;
	on(fn: (msg: string, priority: Priority) => void): () => void;
}

export class SimpleAnnouncer implements Announcer {
	private last?: { message: string; priority: Priority };
	private listeners: Array<(m: string, p: Priority) => void> = [];

	announce(message: string, priority: Priority = 'polite') {
		this.last = { message, priority };
		for (const l of this.listeners) {
			l(message, priority);
		}
	}

	getLast() {
		return this.last;
	}

	on(fn: (msg: string, priority: Priority) => void): () => void {
		this.listeners.push(fn);
		return () => {
			const i = this.listeners.indexOf(fn);
			if (i >= 0) {
				this.listeners.splice(i, 1);
			}
		};
	}
}
