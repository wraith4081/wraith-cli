import type {
	PanelController,
	PanelRegistryAPI,
	RegisteredPanel,
} from './types.js';

function norm(id: string): string {
	return id.trim().toLowerCase();
}

export class PanelRegistry implements PanelRegistryAPI {
	private readonly byId = new Map<string, PanelController>();
	private readonly alias = new Map<string, string>();

	register(
		id: string,
		controller: PanelController,
		aliases: string[] = []
	): void {
		const nid = norm(id);
		if (!nid) {
			throw new Error('Panel id must be non-empty');
		}
		if (this.byId.has(nid)) {
			throw new Error(`Panel '${nid}' already registered`);
		}
		this.byId.set(nid, controller);
		for (const a of aliases) {
			const na = norm(a);
			if (this.alias.has(na) || this.byId.has(na)) {
				throw new Error(
					`Alias '${na}' for '${nid}' conflicts with existing id/alias`
				);
			}
			this.alias.set(na, nid);
		}
	}

	private resolve(idOrAlias: string): string | undefined {
		const key = norm(idOrAlias);
		return this.byId.has(key) ? key : this.alias.get(key);
	}

	get(idOrAlias: string): PanelController | undefined {
		const id = this.resolve(idOrAlias);
		return id ? this.byId.get(id) : undefined;
	}

	list(): RegisteredPanel[] {
		const out: RegisteredPanel[] = [];
		for (const [id] of this.byId) {
			const aliases: string[] = [];
			for (const [a, target] of this.alias) {
				if (target === id) {
					aliases.push(a);
				}
			}
			out.push({ id, aliases });
		}
		return out;
	}

	isOpen(idOrAlias: string): boolean {
		const c = this.get(idOrAlias);
		if (!c) {
			throw new Error(`Unknown panel '${idOrAlias}'`);
		}
		return c.isOpen();
	}

	async open(idOrAlias: string): Promise<void> {
		const c = this.get(idOrAlias);
		if (!c) {
			throw new Error(`Unknown panel '${idOrAlias}'`);
		}
		if (!c.isOpen()) {
			await c.open();
		}
	}

	async close(idOrAlias: string): Promise<void> {
		const c = this.get(idOrAlias);
		if (!c) {
			throw new Error(`Unknown panel '${idOrAlias}'`);
		}
		if (c.isOpen()) {
			await c.close();
		}
	}

	async toggle(idOrAlias: string): Promise<void> {
		const c = this.get(idOrAlias);
		if (!c) {
			throw new Error(`Unknown panel '${idOrAlias}'`);
		}
		await c.toggle();
	}

	async focus(idOrAlias: string): Promise<void> {
		const c = this.get(idOrAlias);
		if (!c) {
			throw new Error(`Unknown panel '${idOrAlias}'`);
		}
		await c.focus();
	}
}
