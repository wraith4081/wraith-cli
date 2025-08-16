import { childLogger } from '@obs/logger';

const log = childLogger({ mod: 'diagnostics.optional-deps' });

type Check = {
	name: string;
	why: string;
	install: string;
	tryImport: string;
};

const OPTIONALS: Check[] = [
	{
		name: 'lancedb',
		why: 'RAG LanceDB vector store driver',
		install: 'bun add lancedb',
		tryImport: 'lancedb',
	},
	{
		name: '@qdrant/js-client-rest',
		why: 'RAG Qdrant vector store driver',
		install: 'bun add @qdrant/js-client-rest',
		tryImport: '@qdrant/js-client-rest',
	},
	{
		name: 'pg',
		why: 'RAG pgvector driver',
		install: 'bun add pg',
		tryImport: 'pg',
	},
	{
		name: 'onnxruntime-node',
		why: 'Local embeddings (ONNX) — optional fallback if no API',
		install: 'bun add onnxruntime-node',
		tryImport: 'onnxruntime-node',
	},
	{
		name: '@xenova/transformers',
		why: 'Local CPU embeddings (WASM) — optional',
		install: 'bun add @xenova/transformers',
		tryImport: '@xenova/transformers',
	},
];

export async function checkOptionalDeps(): Promise<void> {
	const missing: Check[] = [];
	for (const c of OPTIONALS) {
		try {
			// Dynamic import; if it fails, we record a hint. We don't crash.
			await import(c.tryImport);
		} catch {
			missing.push(c);
		}
	}
	if (missing.length) {
		log.warn({
			msg: 'optional-deps.missing',
			count: missing.length,
			modules: missing.map((m) => m.name),
		});
		const lines = missing
			.map((m) => `- ${m.name}: ${m.why} — install: ${m.install}`)
			.join('\n');
		// Friendly, non-fatal notice:
		// (Intentionally a single console.log to avoid polluting JSON outputs)
		// biome-ignore lint/suspicious/noConsole: tbd
		console.log(
			`\n[notice] Optional components not installed (features will gracefully degrade):\n${lines}\n`
		);
	}
}
