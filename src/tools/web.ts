import {
	type FetchUrlOptions,
	fetchAndNormalizeUrl,
	type UrlAttachment,
} from '@ingest/url';
import { ToolPermissionError } from '@tools/errors';
import type { ToolRegistry } from '@tools/registry';
import type { ToolHandler, ToolSpec } from '@tools/types';

function assertHttp(url: string): void {
	// Only allow http(s) — keep it simple & predictable
	if (!/^https?:\/\//i.test(url)) {
		throw new ToolPermissionError(
			'web.fetch',
			`Only http(s) URLs are allowed: ${url}`
		);
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

	const res: UrlAttachment = await fetchAndNormalizeUrl(p.url, opts);

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
