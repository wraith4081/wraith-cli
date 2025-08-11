import pino from 'pino';

const redactions = [
	'process.env.OPENAI_API_KEY',
	'OPENAI_API_KEY',
	'apiKey',
	'authorization',
	'Authorization',
];

export function createLogger(
	level: 'debug' | 'info' | 'warn' | 'error' = 'info'
) {
	return pino({
		level,
		redact: {
			paths: redactions,
			censor: '***',
		},
	});
}
