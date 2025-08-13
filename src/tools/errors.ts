export class ToolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ToolError';
	}
}

export class ToolNotFoundError extends ToolError {
	constructor(public readonly tool: string) {
		super(`Tool not found: ${tool}`);
		this.name = 'ToolNotFoundError';
	}
}

export class ToolPermissionError extends ToolError {
	constructor(
		public readonly tool: string,
		public readonly reason: string
	) {
		super(`Permission denied for ${tool}: ${reason}`);
		this.name = 'ToolPermissionError';
	}
}

export class ToolValidationError extends ToolError {
	constructor(
		public readonly tool: string,
		public readonly issues: string[]
	) {
		super(
			issues.length
				? `Invalid parameters for ${tool}:\n- ${issues.join('\n- ')}`
				: `Invalid parameters for ${tool}`
		);
		this.name = 'ToolValidationError';
	}
}

export class ToolExecutionError extends ToolError {
	constructor(
		public readonly tool: string,
		cause: unknown
	) {
		super(
			`Execution failed for ${tool}: ${cause instanceof Error ? cause.message : String(cause)}`
		);
		this.name = 'ToolExecutionError';
		this.cause = cause;
	}
}
