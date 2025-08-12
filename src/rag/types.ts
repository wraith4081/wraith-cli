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

export interface RetrievedChunk {
	score: number;
	source: 'hot' | string; // 'hot' or cold driver name
	chunk: ChunkEmbedding;
}

export interface ColdIndexDriver {
	name: string;
	upsert(items: ChunkEmbedding[]): Promise<void>;
	queryByVector(
		vector: number[],
		opts: { topK: number; filter?: { model?: string } }
	): Promise<Array<{ score: number; chunk: ChunkEmbedding }>>;
}

// New: minimal cold index driver contract for 7.x
export interface ColdIndexDriver {
	init(): Promise<void>;
	upsert(chunks: ChunkEmbedding[]): Promise<number>;
	search(
		queryVector: number[],
		opts?: { topK?: number; modelFilter?: string; scoreThreshold?: number }
	): Promise<RetrievedChunk[]>;
	deleteByIds?(ids: string[]): Promise<number>;
	close?(): Promise<void>;
}
