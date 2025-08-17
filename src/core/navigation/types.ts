export type Route = string;

export interface RouterAPI {
	getCurrent(): Route | undefined;
	exists(route: Route): boolean;
	goTo(route: Route): Promise<void> | void;
}

export interface NavigateResult {
	status: 'ok' | 'already-open' | 'not-found';
	route?: Route;
	message?: string;
}

export interface FocusInfo {
	kind: 'actionable' | 'non-actionable' | 'input' | 'primary-action';
	// For actionable elements, a route or a handler may be provided
	route?: Route;
	activate?: () => Promise<void> | void;
	// For input elements, indicate enter behavior
	inputBehavior?: 'submit' | 'newline' | 'ignore';
	submit?: () => Promise<void> | void;
}

export interface FocusResolver {
	current(): FocusInfo | undefined;
}

export interface ActivationResult {
	status: 'activated' | 'no-op' | 'error';
	message?: string;
}
