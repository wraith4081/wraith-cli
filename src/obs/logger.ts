import winston from 'winston';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SECRET_KEYS = new Set([
	'OPENAI_API_KEY',
	'authorization',
	'Authorization',
	'apiKey',
]);

function redactDeep(value: unknown): unknown {
	if (value && typeof value === 'object') {
		if (Array.isArray(value)) {
			return (value as unknown[]).map(redactDeep);
		}
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			if (SECRET_KEYS.has(k)) {
				out[k] = '***';
			} else if (
				k.toLowerCase().includes('token') ||
				k.toLowerCase().includes('secret')
			) {
				out[k] = '***';
			} else {
				out[k] = redactDeep(v);
			}
		}
		return out;
	}
	return value;
}

const redactFormat = winston.format((info) => {
	const clone = { ...info };
	if (clone.message && typeof clone.message === 'object') {
		clone.message = redactDeep(clone.message);
	}
	for (const k of Object.keys(clone)) {
		if (k !== 'level' && k !== 'message' && k !== 'timestamp') {
			clone[k] = redactDeep(clone[k]);
		}
	}
	return clone;
});

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
let baseLogger: winston.Logger | null = null;

function buildLogger(level: LogLevel): winston.Logger {
	return winston.createLogger({
		level,
		levels: winston.config.npm.levels, // debug/info/warn/error
		format: winston.format.combine(
			redactFormat(),
			winston.format.timestamp(),
			winston.format.json()
		),
		transports: [
			new winston.transports.Console({
				stderrLevels: ['error'],
			}),
		],
	});
}

export function setLogLevel(level: LogLevel) {
	currentLevel = level;
	baseLogger = buildLogger(level);
}

export function getLogger(): winston.Logger {
	if (!baseLogger) {
		baseLogger = buildLogger(currentLevel);
	}
	return baseLogger;
}

export function childLogger(
	bindings: Record<string, unknown> = {}
): winston.Logger {
	return getLogger().child(bindings);
}
