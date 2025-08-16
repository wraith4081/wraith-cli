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
				k.toLowerCase().includes('secret') ||
				k.toLowerCase().includes('apikey') ||
				k.toLowerCase().includes('api_key')
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

/**
 * Scrub secret-looking values from arbitrary strings (for user-visible output).
 * - masks any env var values whose keys look secret-ish
 * - masks common bearer/api key patterns (e.g., "sk-...")
 */
export function scrubSecretsFromText(s: string | undefined | null): string {
	if (!s) {
		return '';
	}

	let out = s;

	// Mask known env values by heuristic key names
	for (const [key, val] of Object.entries(process.env)) {
		if (!val || typeof val !== 'string') {
			continue;
		}
		const k = key.toLowerCase();
		if (
			k.includes('token') ||
			k.includes('secret') ||
			k.includes('apikey') ||
			k.includes('api_key') ||
			k.includes('openai')
		) {
			// Replace as a whole substring (avoid leaking)
			try {
				if (val.length >= 6) {
					const esc = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
					out = out.replace(new RegExp(esc, 'g'), '***');
				}
			} catch {
				/* ignore bad regex */
			}
		}
	}

	// Generic bearer/JWT/API key-ish patterns
	out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi, 'Bearer ***');
	out = out.replace(/\b(sk|rk|pk)_[A-Za-z0-9]{12,}\b/g, '$1_***');
	out = out.replace(/\bapi[_-]?key=([A-Za-z0-9._-]{6,})/gi, 'api_key=***');

	return out;
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
