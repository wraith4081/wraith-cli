import { fetchAndNormalizeUrl, fetchAndNormalizeUrls } from '@ingest/url';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BASE = 'http://test.local';

const server = setupServer(
	http.get(`${BASE}/plain`, () => {
		return HttpResponse.text('hello plain', {
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		});
	}),
	http.get(`${BASE}/html`, () => {
		const html = `
      <!doctype html>
      <html><head><title>Test Page</title></head>
      <body>
        <h1>Welcome</h1>
        <p>See <a href="/link">this link</a> and some <code>inline()</code>.</p>
        <pre><code class="language-ts">const x = 1;\nconsole.log(x);</code></pre>
      </body></html>`;
		return new HttpResponse(html, {
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		});
	}),
	http.get(`${BASE}/large-known`, () => {
		const len = 2_000_000;
		return new HttpResponse('x'.repeat(len), {
			headers: {
				'Content-Type': 'text/plain',
				'Content-Length': String(len),
			},
		});
	}),
	http.get(`${BASE}/large-stream`, () => {
		// No Content-Length; body larger than cap
		const len = 2_000_000;
		return new HttpResponse('y'.repeat(len), {
			headers: { 'Content-Type': 'text/plain' },
		});
	}),
	http.get(`${BASE}/json`, () => {
		return HttpResponse.json({ a: 1, b: 'two' });
	}),
	http.get(`${BASE}/404`, () => {
		return new HttpResponse('not found', {
			status: 404,
			headers: { 'Content-Type': 'text/plain' },
		});
	}),
	http.get(`${BASE}/img`, () => {
		return new HttpResponse('binary', {
			headers: { 'Content-Type': 'image/png' },
		});
	})
);

beforeAll(() => server.listen());
afterAll(() => server.close());

describe('URL fetch and normalization', () => {
	it('fetches plain text', async () => {
		const res = await fetchAndNormalizeUrl(`${BASE}/plain`, {
			maxBytes: 1024 * 1024,
		});
		expect(res.ok).toBe(true);
		expect(res.included).toBe(true);
		expect(res.text).toContain('hello plain');
		expect(res.tokenEstimate).toBeGreaterThan(0);
	});

	it('fetches HTML and converts to markdown with title and link', async () => {
		const res = await fetchAndNormalizeUrl(`${BASE}/html`, {
			maxBytes: 1024 * 1024,
		});
		expect(res.ok).toBe(true);
		expect(res.included).toBe(true);
		expect(res.text).toContain('# Test Page'); // title
		expect(res.text).toMatch(/\[this link\]\(http:\/\/test\.local\/link\)/);
		expect(res.text).toMatch(/```/); // fenced code
	});

	it('respects maxBytes via Content-Length', async () => {
		const res = await fetchAndNormalizeUrl(`${BASE}/large-known`, {
			maxBytes: 1024,
		});
		expect(res.ok).toBe(false);
		expect(res.included).toBe(false);
		expect(res.reason).toBe('too-large');
	});

	it('truncates when streaming exceeds maxBytes without Content-Length', async () => {
		const res = await fetchAndNormalizeUrl(`${BASE}/large-stream`, {
			maxBytes: 8000,
		});
		expect(res.ok).toBe(true); // still ok
		expect(res.truncated).toBe(true);
		expect(res.included).toBe(true);
	});

	it('pretty-prints JSON and fences it', async () => {
		const res = await fetchAndNormalizeUrl(`${BASE}/json`);
		expect(res.ok).toBe(true);
		expect(res.text?.startsWith('```json')).toBe(true);
	});

	it('handles HTTP errors', async () => {
		const res = await fetchAndNormalizeUrl(`${BASE}/404`);
		expect(res.ok).toBe(false);
		expect(res.reason).toBe('http-status');
		expect(res.status).toBe(404);
	});

	it('rejects unsupported content types', async () => {
		const res = await fetchAndNormalizeUrl(`${BASE}/img`);
		expect(res.ok).toBe(false);
		expect(res.reason).toBe('unsupported-content-type');
	});

	it('batch fetchAndNormalizeUrls splits included vs skipped', async () => {
		const { included, skipped } = await fetchAndNormalizeUrls([
			`${BASE}/plain`,
			`${BASE}/img`,
		]);
		expect(included.length).toBe(1);
		expect(skipped.length).toBe(1);
	});
});
