import { TextDecoder } from 'node:util';

export interface UrlAttachment {
	url: string;
	ok: boolean;
	included: boolean;
	status?: number;
	contentType?: string;
	bytes: number;
	text?: string; // normalized text (markdown for html)
	truncated?: boolean;
	reason?:
		| 'too-large'
		| 'http-status'
		| 'unsupported-content-type'
		| 'network-error';
	error?: string;
	title?: string;
	tokenEstimate?: number;
}

export interface FetchUrlOptions {
	maxBytes?: number; // cap on response body bytes (default: 1 MiB)
	timeoutMs?: number; // abort after timeout
	acceptedTypes?: string[]; // whitelist of content-types (default text/* + json)
	userAgent?: string;
	signal?: AbortSignal;
}

const DEFAULT_MAX_BYTES = 1_048_576; // 1 MiB
const DEFAULT_ACCEPTED = [
	'text/plain',
	'text/markdown',
	'text/html',
	'application/json',
];

function estimateTokensFromBytes(bytes: number): number {
	return Math.ceil(bytes / 4);
}

function parseContentType(ct?: string | null): {
	type?: string;
	charset?: string;
} {
	if (!ct) {
		return {};
	}
	const [typeRaw, ...params] = ct.split(';').map((s) => s.trim());
	const type = typeRaw?.toLowerCase();
	let charset: string | undefined;
	for (const p of params) {
		const [k, v] = p.split('=');
		if (k?.toLowerCase() === 'charset' && v) {
			charset = v.trim().replace(/^"|"$/g, '');
		}
	}
	return { type, charset };
}
async function readStreamWithCap(
	response: Response,
	maxBytes: number
): Promise<{ data: Uint8Array; bytes: number; truncated: boolean }> {
	const body: unknown = response.body;

	// Fallback: if no Web Streams reader, use arrayBuffer() and clamp.
	const hasReader =
		body &&
		typeof (body as { getReader?: unknown }).getReader === 'function';

	if (!hasReader) {
		const ab = await response.arrayBuffer();
		const buf = new Uint8Array(ab);
		if (buf.byteLength <= maxBytes) {
			return { data: buf, bytes: buf.byteLength, truncated: false };
		}
		return {
			data: buf.slice(0, maxBytes),
			bytes: maxBytes,
			truncated: true,
		};
	}

	// Stream with cap
	const reader = (body as ReadableStream<Uint8Array>).getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	let truncated = false;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			if (!value) {
				continue;
			}

			// If this chunk would exceed cap, trim and stop.
			if (received + value.byteLength > maxBytes) {
				const remaining = maxBytes - received;
				if (remaining > 0) {
					chunks.push(value.slice(0, remaining));
				}
				truncated = true;
				// End the reader without awaiting cancellation (avoid hangs).
				try {
					// Cancel without awaiting to prevent potential hangs.
					reader.cancel();
				} catch {
					// ignore
				}
				break;
			}

			chunks.push(value);
			received += value.byteLength;
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// ignore
		}
	}

	const data = concat(chunks);
	return { data, bytes: data.byteLength, truncated };
}

function concat(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((acc, p) => acc + p.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.byteLength;
	}
	return out;
}

function htmlToMarkdown(
	html: string,
	baseUrl?: string
): { markdown: string; title?: string } {
	// drop scripts/styles
	let s = html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '');

	// title
	const titleMatch = s.match(/<title[^>]*>([^<]*)<\/title>/i);
	const title = titleMatch
		? decodeEntities(titleMatch[1]?.trim() ?? '')
		: undefined;

	// headings
	s = s.replace(
		/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi,
		(_, tag: string, inner: string) => {
			const level = Number(tag.slice(1));
			const text = decodeEntities(stripTags(inner).trim());
			return `\n${'#'.repeat(Math.min(level, 6))} ${text}\n`;
		}
	);

	// blockquotes
	s = s.replace(
		/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
		(_, inner: string) => {
			const text = stripTags(inner)
				.split(/\r?\n/)
				.map((l) => (l.trim() ? `> ${decodeEntities(l)}` : '>'))
				.join('\n');
			return `\n${text}\n`;
		}
	);

	// code blocks (<pre><code ...>...</code></pre> or <pre>...</pre>)
	s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
		// try to capture <code class="language-xxx">
		const codeMatch = inner.match(
			/<code[^>]*class=["'][^"']*language-([^"']+)["'][^>]*>([\s\S]*?)<\/code>/i
		);
		let lang = '';
		let code = inner;
		if (codeMatch) {
			lang = codeMatch[1] ?? '';
			code = codeMatch[2] ?? '';
		}
		const content = decodeEntities(
			stripTagsPreserveNewlines(code).trimEnd()
		);
		return `\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
	});

	// inline code
	s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, inner: string) => {
		const content = decodeEntities(stripTags(inner));
		return `\`${content}\``;
	});

	// lists
	s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => {
		const text = decodeEntities(stripTags(inner).trim());
		return `\n- ${text}`;
	});
	s = s.replace(/<\/(ul|ol)>/gi, '\n');

	// links
	s = s.replace(
		/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
		(_, href: string, inner: string) => {
			const text = decodeEntities(stripTags(inner).trim()) || href;
			const url = toAbsoluteUrl(href, baseUrl);
			return `[${text}](${url})`;
		}
	);

	// images
	s = s.replace(
		/<img\s+[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi,
		(_, src: string, alt: string) => {
			const url = toAbsoluteUrl(src, baseUrl);
			return `![${decodeEntities(alt)}](${url})`;
		}
	);
	s = s.replace(
		/<img\s+[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*\/?>/gi,
		(_, alt: string, src: string) => {
			const url = toAbsoluteUrl(src, baseUrl);
			return `![${decodeEntities(alt)}](${url})`;
		}
	);

	// paragraphs and breaks
	s = s.replace(/<br\s*\/?>/gi, '\n');
	s = s.replace(/<\/p>/gi, '\n');
	s = s.replace(/<p[^>]*>/gi, '\n');

	// strip remaining tags
	s = stripTags(s);

	// collapse excessive blank lines
	s = s.replace(/\n{3,}/g, '\n\n').trim();

	// prepend title as first-level heading if present and not already first line
	let md = s;
	if (title && !md.startsWith('# ')) {
		md = `# ${title}\n\n${md}`;
	}

	return { markdown: md, title };
}

function stripTags(input: string): string {
	return input.replace(/<\/?[^>]+>/g, '');
}

function stripTagsPreserveNewlines(input: string): string {
	// remove tags but keep newlines for code/pre
	return input.replace(/<\/?[^>]+>/g, (m) => (/\n/.test(m) ? '\n' : ''));
}

function decodeEntities(s: string): string {
	// minimal decoding for common entities
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function toAbsoluteUrl(href: string, baseUrl?: string): string {
	try {
		return new URL(href, baseUrl).toString();
	} catch {
		return href;
	}
}

export async function fetchAndNormalizeUrl(
	url: string,
	opts: FetchUrlOptions = {}
): Promise<UrlAttachment> {
	const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
	const accepted = opts.acceptedTypes ?? DEFAULT_ACCEPTED;
	const controller = new AbortController();
	const signal = opts.signal ?? controller.signal;

	let timeout: NodeJS.Timeout | null = null;
	try {
		if (opts.timeoutMs && opts.timeoutMs > 0) {
			timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
		}

		const res = await fetch(url, {
			headers: {
				'User-Agent': opts.userAgent ?? 'wraith-cli/0.0.1',
				Accept: accepted.join(', '),
			},
			signal,
		});

		const ctRaw = res.headers.get('content-type');
		const { type: contentType, charset } = parseContentType(ctRaw);

		// Early max-size check via Content-Length
		const lenHeader = res.headers.get('content-length');
		if (lenHeader) {
			const len = Number.parseInt(lenHeader, 10);
			if (Number.isFinite(len) && len > maxBytes) {
				return {
					url,
					ok: false,
					included: false,
					status: res.status,
					contentType,
					bytes: len,
					reason: 'too-large',
					error: `Content-Length ${len} exceeds limit ${maxBytes}`,
				};
			}
		}

		if (!res.ok) {
			return {
				url,
				ok: false,
				included: false,
				status: res.status,
				contentType,
				bytes: 0,
				reason: 'http-status',
				error: `HTTP ${res.status}`,
			};
		}

		// Stream with cap
		const { data, bytes, truncated } = await readStreamWithCap(
			res,
			maxBytes
		);

		// Decode according to charset (default utf-8)
		const decoder = new TextDecoder((charset || 'utf-8').toLowerCase());
		const rawText = decoder.decode(data);

		// Type routing
		if (contentType?.startsWith('text/html')) {
			const { markdown, title } = htmlToMarkdown(rawText, url);
			return {
				url,
				ok: true,
				included: true,
				status: res.status,
				contentType,
				bytes,
				text: markdown,
				truncated,
				title,
				tokenEstimate: estimateTokensFromBytes(
					Buffer.byteLength(markdown, 'utf8')
				),
			};
		}

		if (
			contentType?.startsWith('text/plain') ||
			contentType?.startsWith('text/markdown')
		) {
			const text = rawText;
			return {
				url,
				ok: true,
				included: true,
				status: res.status,
				contentType,
				bytes,
				text,
				truncated,
				tokenEstimate: estimateTokensFromBytes(
					Buffer.byteLength(text, 'utf8')
				),
			};
		}

		if (
			contentType === 'application/json' ||
			contentType?.startsWith('application/json')
		) {
			try {
				const obj = JSON.parse(rawText);
				const pretty = JSON.stringify(obj, null, 2);
				const fenced = `\`\`\`json\n${pretty}\n\`\`\``;
				return {
					url,
					ok: true,
					included: true,
					status: res.status,
					contentType,
					bytes,
					text: fenced,
					truncated,
					tokenEstimate: estimateTokensFromBytes(
						Buffer.byteLength(fenced, 'utf8')
					),
				};
			} catch {
				// If it lies about JSON, treat as plain text
				const text = rawText;
				return {
					url,
					ok: true,
					included: true,
					status: res.status,
					contentType,
					bytes,
					text,
					truncated,
					tokenEstimate: estimateTokensFromBytes(
						Buffer.byteLength(text, 'utf8')
					),
				};
			}
		}

		// Unsupported
		return {
			url,
			ok: false,
			included: false,
			status: res.status,
			contentType,
			bytes,
			reason: 'unsupported-content-type',
			error: `Unsupported content-type: ${contentType ?? 'unknown'}`,
		};
	} catch (e) {
		return {
			url,
			ok: false,
			included: false,
			bytes: 0,
			reason: 'network-error',
			error: e instanceof Error ? e.message : String(e),
		};
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
		if (!opts.signal) {
			controller.abort();
		}
	}
}

export async function fetchAndNormalizeUrls(
	urls: string[],
	opts: FetchUrlOptions = {}
): Promise<{ included: UrlAttachment[]; skipped: UrlAttachment[] }> {
	const included: UrlAttachment[] = [];
	const skipped: UrlAttachment[] = [];
	for (const u of urls) {
		const res = await fetchAndNormalizeUrl(u, opts);
		if (res.included) {
			included.push(res);
		} else {
			skipped.push(res);
		}
	}
	return { included, skipped };
}
