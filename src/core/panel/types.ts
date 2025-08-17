export interface PanelController {
	open(): void | Promise<void>;
	close(): void | Promise<void>;
	toggle(): void | Promise<void>;
	focus(): void | Promise<void>;
	isOpen(): boolean;
}

export interface RegisteredPanel {
	id: string;
	aliases: string[];
}

export interface PanelRegistryAPI {
	register(id: string, controller: PanelController, aliases?: string[]): void;
	get(idOrAlias: string): PanelController | undefined;
	list(): RegisteredPanel[];
	open(idOrAlias: string): Promise<void>;
	close(idOrAlias: string): Promise<void>;
	toggle(idOrAlias: string): Promise<void>;
	focus(idOrAlias: string): Promise<void>;
	isOpen(idOrAlias: string): boolean;
}
