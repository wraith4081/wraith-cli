import {
	type FetchUrlOptions,
	fetchAndNormalizeUrl,
	type UrlAttachment,
} from '@ingest/url';
import { childLogger } from '@obs/logger';
import { ToolPermissionError } from '@tools/errors';
import type { ToolRegistry } from '@tools/registry';
import type { ToolHandler, ToolSpec } from '@tools/types';

const log = childLogger({ mod: 'tools.web' });

function assertHttp(url: string): void {
	// Only allow http(s) — keep it simple & predictable
	if (!/^https?:\/\//i.test(url)) {
		log.warn({ msg: 'web.fetch.invalid-protocol', url });
		throw new ToolPermissionError(
			'web.fetch',
			`Only http(s) URLs are allowed: ${url}`
		);
	}
}

function sanitizeUrl(u: string): string {
	try {
		const parsed = new URL(u);
		const sensitive =
			/^(token|key|secret|sig|signature|auth|authorization|apikey|access[_-]?token)$/i;
		for (const [k] of parsed.searchParams) {
			if (sensitive.test(k)) {
				parsed.searchParams.set(k, '***');
			}
		}
		return parsed.toString();
	} catch {
		// if it doesn't parse, return as-is (still just a string)
		return u;
	}
}

export const WebFetchSpec: ToolSpec = {
	name: 'web.fetch',
	title: 'Fetch a URL (GET)',
	description:
		'HTTP GET with normalization (HTML→Markdown, JSON pretty). Byte cap, timeout, and network permission gating.',
	requiredPermissions: ['net'],
	paramsSchema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			url: { type: 'string', format: 'uri' },
			timeoutMs: { type: 'integer', minimum: 100, default: 10_000 },
			maxBytes: { type: 'integer', minimum: 1024, default: 1_048_576 },
			accept: {
				type: 'array',
				items: { type: 'string', minLength: 3 },
				default: [
					'text/plain',
					'text/markdown',
					'text/html',
					'application/json',
				],
			},
			userAgent: { type: 'string' },
		},
		required: ['url'],
	},
};

const fetchHandler: ToolHandler = async (params, _ctx) => {
	const t0 = Date.now();
	const p = params as {
		url: string;
		timeoutMs?: number;
		maxBytes?: number;
		accept?: string[];
		userAgent?: string;
	};

	// Net permission is enforced by the registry; we add a protocol check here.
	assertHttp(p.url);

	const opts: FetchUrlOptions = {
		timeoutMs: Math.max(100, p.timeoutMs ?? 10_000),
		maxBytes: Math.max(1024, p.maxBytes ?? 1_048_576),
		acceptedTypes: p.accept && p.accept.length > 0 ? p.accept : undefined,
		userAgent: p.userAgent,
	};

	log.info({
		msg: 'web.fetch.start',
		url: sanitizeUrl(p.url),
		timeoutMs: opts.timeoutMs,
		maxBytes: opts.maxBytes,
		accept: opts.acceptedTypes,
		hasUserAgent: Boolean(opts.userAgent),
	});

	const res: UrlAttachment = await fetchAndNormalizeUrl(p.url, opts);

	log.info({
		msg: 'web.fetch.done',
		url: sanitizeUrl(res.url ?? p.url),
		ok: res.ok,
		status: res.status,
		bytes: res.bytes,
		truncated: res.truncated ?? false,
		contentType: res.contentType,
		tokenEstimate: res.tokenEstimate,
		ms: Date.now() - t0,
	});

	// Shape the output to a stable tool result surface
	return {
		ok: res.ok,
		status: res.status,
		url: res.url,
		bytes: res.bytes,
		contentType: res.contentType,
		truncated: res.truncated ?? false,
		text: res.text,
		title: res.title,
		tokenEstimate: res.tokenEstimate,
		reason: res.reason,
		error: res.error,
	};
};

export function registerWebTools(reg: ToolRegistry): void {
	reg.register(WebFetchSpec, fetchHandler);
}
