import type { Chunk } from '@ingest/chunking';

export interface EmbeddingRequestItem {
	id: string; // stable identifier (e.g., chunk sha256)
	text: string; // text to embed
}

export interface EmbeddingResultItem {
	id: string;
	vector: number[];
	dim: number;
}

export interface ChunkEmbedding {
	id: string; // chunk sha256
	filePath: string; // relative POSIX path
	startLine: number; // 1-based
	endLine: number; // 1-based
	model: string; // embedding model used
	vector: number[];
	dim: number;
	tokensEstimated: number;
	chunkRef: Chunk; // original chunk (for provenance)
}
