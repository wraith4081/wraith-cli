import pino, { type Logger } from 'pino';

const redactions = [
	'process.env.OPENAI_API_KEY',
	'OPENAI_API_KEY',
	'apiKey',
	'authorization',
	'Authorization',
	'headers.authorization',
	'config.headers.Authorization',
];

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
let logger: Logger | null = null;

function buildLogger(level: LogLevel): Logger {
	return pino({
		level,
		redact: {
			paths: redactions,
			censor: '***',
		},
	});
}

export function setLogLevel(level: LogLevel) {
	currentLevel = level;
	logger = buildLogger(level);
}

export function getLogger(): Logger {
	if (!logger) {
		logger = buildLogger(currentLevel);
	}
	return logger;
}

export function childLogger(bindings: Record<string, unknown> = {}): Logger {
	return getLogger().child(bindings);
}
