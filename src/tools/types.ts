export type Permission = 'fs' | 'net' | 'shell';

export interface ToolSpec {
	/** Unique tool name, e.g. "fs.read" */
	name: string;
	title?: string;
	description?: string;
	/** Minimal permissions the tool needs to run */
	requiredPermissions?: Permission[];
	/**
	 * JSON Schema (Draft 2020-12 compatible) describing the params payload.
	 * If omitted, no validation is performed.
	 */
	paramsSchema?: Record<string, unknown>;
}

export interface ToolPolicy {
	/**
	 * If provided, only these tools are allowed. If omitted, all tools are allowed
	 * unless explicitly listed in deniedTools.
	 */
	allowedTools?: string[];
	/** Always deny these tools. Takes precedence over allowedTools. */
	deniedTools?: string[];
	/**
	 * If provided, a tool may execute only if (requiredPermissions ⊆ allowPermissions).
	 * If omitted, all permissions are allowed unless explicitly denied.
	 */
	allowPermissions?: Permission[];
	/** Required permissions intersecting denyPermissions cause a denial. */
	denyPermissions?: Permission[];
}

export interface ToolContext {
	/** Working directory or project root. */
	cwd: string;
	/** Current policy for gating tools. */
	policy: ToolPolicy;
	/** Optional logger facade (keep it tiny to avoid coupling) */
	logger?: {
		debug?: (msg: string, meta?: unknown) => void;
		info?: (msg: string, meta?: unknown) => void;
		warn?: (msg: string, meta?: unknown) => void;
		error?: (msg: string, meta?: unknown) => void;
	};
}

export type ToolHandler = (
	params: unknown,
	ctx: ToolContext
) => Promise<unknown> | unknown;

export interface RegisteredTool {
	spec: ToolSpec;
	handler: ToolHandler;
}
