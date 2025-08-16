import fs from 'node:fs';
import path from 'node:path';
import type {
	ChunkEmbedding,
	ColdIndexDriver,
	RetrievedChunk,
} from '@rag/types';
import { coldIndexDir } from '@util/paths';

// Light, local interfaces to avoid hard deps in tests
type LanceDBConnect = (uri: string) => Promise<LanceDB>;
interface LanceDB {
	openTable(name: string): Promise<LanceTable>;
	createTable(name: string, data: unknown): Promise<LanceTable>;
	createEmptyTable?(
		name: string,
		schema: unknown,
		opts?: unknown
	): Promise<LanceTable>;
}
interface LanceTable {
	add(data: unknown[]): Promise<number>;
	mergeInsert?(on: string, data: unknown[], args: unknown): Promise<void>;
	createScalarIndex?(column: string, replace?: boolean): Promise<void>;
	search(vector: number[]): LanceQuery;
}
interface LanceQuery {
	where(predicate: string): LanceQuery;
	limit(k: number): LanceQuery;
	toArray(): Promise<unknown[]>;
}

export interface LanceDBDriverOptions {
	baseDir?: string; // directory to hold the LanceDB database
	tableName?: string; // table name
	ensureScalarIndexes?: boolean; // create scalar indices on id + model
	vectorIndex?: boolean; // placeholder for future ANN settings
	// for testing; lets us inject a fake connect()
	connectImpl?: LanceDBConnect;
	// for testing; avoid arrow import
	buildArrowSchemaImpl?: (dim: number) => unknown;
}

const DEFAULT_TABLE = 'rag_chunks';
const DEFAULT_SUBDIR = 'lancedb';

function toStringSafe(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}
function toNumberSafe(v: unknown, fallback = 0): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function toVectorSafe(v: unknown): number[] {
	return Array.isArray(v) ? v.map((n) => Number(n) || 0) : [];
}

export class LanceDBDriver implements ColdIndexDriver {
	private opts: LanceDBDriverOptions;
	private db?: LanceDB;
	private table?: LanceTable;
	private readonly dir: string;
	private readonly tableName: string;
	name = 'lancedb';

	constructor(opts: LanceDBDriverOptions = {}) {
		this.opts = opts;
		const base = opts.baseDir ?? path.join(coldIndexDir, DEFAULT_SUBDIR);
		if (!fs.existsSync(base)) {
			fs.mkdirSync(base, { recursive: true });
		}
		this.dir = base;
		this.tableName = opts.tableName ?? DEFAULT_TABLE;
	}

	async init(): Promise<void> {
		if (!this.db) {
			const connect: LanceDBConnect =
				this.opts.connectImpl ?? (await this.lazyLoadConnect());
			this.db = await connect(this.dir);
		}
		if (!this.table) {
			this.table = await this.openOrCreateTable();
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: fix
	async upsert(chunks: ChunkEmbedding[]): Promise<any> {
		if (chunks.length === 0) {
			return 0;
		}
		await this.init();
		const table = this.table;
		const rows = chunks.map((c) => ({
			id: c.id,
			vector: c.vector,
			model: c.model,
			filePath: c.filePath,
			startLine: c.startLine,
			endLine: c.endLine,
			dim: c.dim,
			tokensEstimated: c.tokensEstimated,
		}));

		// Prefer mergeInsert (upsert). If not available, fall back to add().
		if (typeof table?.mergeInsert === 'function') {
			await table.mergeInsert('id', rows, {
				whenMatchedUpdateAll: true,
				whenNotMatchedInsertAll: true,
			});
			return rows.length;
		}
		return Number(await table?.add(rows));
	}

	async search(
		queryVector: number[],
		opts: {
			topK?: number;
			modelFilter?: string;
			scoreThreshold?: number;
		} = {}
	): Promise<RetrievedChunk[]> {
		await this.init();
		const table = this.table;
		const k = opts.topK ?? 8;

		if (!table) {
			return [];
		}

		let q = table.search(queryVector).limit(k);
		if (opts.modelFilter) {
			// simple SQL where predicate (scalar index on "model" helps)
			q = q.where(`model = '${escapeSql(opts.modelFilter)}'`);
		}
		const res = await q.toArray();

		return (res as Record<string, unknown>[])
			.map((r) => {
				const vec = toVectorSafe(r.vector);
				const score =
					typeof r.score === 'number'
						? r.score
						: typeof r._distance === 'number'
							? 1 / (1 + Number(r._distance))
							: undefined;

				const chunk: ChunkEmbedding = {
					id: toStringSafe(r.id),
					filePath: toStringSafe(r.filePath),
					startLine: toNumberSafe(r.startLine, 1),
					endLine: toNumberSafe(r.endLine, 1),
					model: toStringSafe(r.model),
					vector: vec.slice(),
					dim: toNumberSafe(
						r.dim ??
							(Array.isArray(r.vector) ? r.vector.length : 0),
						vec.length
					),
					tokensEstimated: toNumberSafe(r.tokensEstimated, 0),
					chunkRef: {
						// minimal provenance; full ref is optional here
						filePath: toStringSafe(r.filePath),
						startLine: toNumberSafe(r.startLine, 1),
						endLine: toNumberSafe(r.endLine, 1),
						chunkIndex: 0,
						chunkCount: 0,
						sha256: toStringSafe(r.id),
						content: '',
						tokensEstimated: toNumberSafe(r.tokensEstimated, 0),
						fileType: 'text',
					},
				};
				return {
					chunk,
					score: Number(score),
					source: 'lancedb' as const,
				};
			})
			.filter((hit) =>
				typeof opts.scoreThreshold === 'number'
					? (hit.score ?? 0) >= opts.scoreThreshold
					: true
			);
	}

	async deleteByIds(ids: string[]): Promise<number> {
		await this.init();
		if (ids.length === 0) {
			return 0;
		}
		// delete is available on Table interface, but we kept the type lean; dynamic call:
		const anyTable = this.table as unknown as {
			delete?: (predicate: string) => Promise<void>;
		};
		if (typeof anyTable.delete !== 'function') {
			return 0;
		}
		const list = ids.map((s) => `'${escapeSql(s)}'`).join(',');
		await anyTable.delete(`id IN (${list})`);
		return ids.length;
	}

	async close(): Promise<void> {
		// current JS SDK doesn’t require an explicit close; keep for symmetry
	}

	async queryByVector(): Promise<
		Array<{ score: number; chunk: ChunkEmbedding }>
	> {
		return await Promise.resolve([]);
	}

	private async openOrCreateTable(): Promise<LanceTable> {
		const db = this.db as LanceDB;
		try {
			return await db.openTable(this.tableName);
		} catch {
			// Create empty table with Arrow schema (vector column must be FixedSizeList(Float32))
			const buildSchema =
				this.opts.buildArrowSchemaImpl ??
				(await this.lazyBuildArrowSchema());
			// Default to 1536 so we can create a table before first insert
			const schema = buildSchema(1536);
			if (typeof db.createEmptyTable === 'function') {
				const tbl = await db.createEmptyTable(this.tableName, schema, {
					mode: 'create',
				});
				await this.maybeCreateScalarIndexes(tbl);
				return tbl;
			}
			// Fallback: create with a single dummy row, then delete it
			const dummy = await makeArrowTableFallback(buildSchema, 1536);
			const tbl = await db.createTable(this.tableName, dummy);
			await this.maybeCreateScalarIndexes(tbl);
			const anyTbl = tbl as unknown as {
				delete?: (p: string) => Promise<void>;
			};
			if (typeof anyTbl.delete === 'function') {
				await anyTbl.delete(`id = '__init__'`);
			}
			return tbl;
		}
	}

	private async maybeCreateScalarIndexes(tbl: LanceTable) {
		if (this.opts.ensureScalarIndexes !== false && tbl.createScalarIndex) {
			try {
				await tbl.createScalarIndex('id', true);
			} catch {
				//
			}
			try {
				await tbl.createScalarIndex('model', true);
			} catch {
				//
			}
		}
	}

	private async lazyLoadConnect(): Promise<LanceDBConnect> {
		// dynamic import to keep runtime light unless the driver is used
		return await Promise.resolve(
			(await import('@lancedb/lancedb'))
				.connect as unknown as LanceDBConnect
		);
	}

	private async lazyBuildArrowSchema(): Promise<(dim: number) => unknown> {
		const arrow = (await import('apache-arrow')) as unknown as {
			Schema: new (...args: unknown[]) => unknown;
			Field: new (...args: unknown[]) => unknown;
			FixedSizeList: new (size: number, field: unknown) => unknown;
			Float32: new () => unknown;
			Utf8: new () => unknown;
			Int32: new () => unknown;
		};
		const { Schema, Field, FixedSizeList, Float32, Utf8, Int32 } = arrow;
		return (dim: number) =>
			new Schema([
				new Field('id', new Utf8(), false),
				new Field(
					'vector',
					new FixedSizeList(
						dim,
						new Field('item', new Float32(), true)
					),
					false
				),
				new Field('model', new Utf8(), false),
				new Field('filePath', new Utf8(), false),
				new Field('startLine', new Int32(), false),
				new Field('endLine', new Int32(), false),
				new Field('dim', new Int32(), false),
				new Field('tokensEstimated', new Int32(), false),
			]);
	}
}

// Fallback tiny Arrow table to seed schema when createEmptyTable() is missing.
async function makeArrowTableFallback(
	buildSchema: (pdim: number) => unknown,
	dim: number
) {
	const schema = buildSchema(dim);
	const lancedb = (await import('@lancedb/lancedb')) as {
		makeArrowTable: (rows: unknown[], opts: { schema: unknown }) => unknown;
	};
	return lancedb.makeArrowTable(
		[
			{
				id: '__init__',
				vector: new Array(dim).fill(0),
				model: 'init',
				filePath: '',
				startLine: 0,
				endLine: 0,
				dim,
				tokensEstimated: 0,
			},
		],
		{ schema }
	);
}

function escapeSql(s: string): string {
	return s.replace(/'/g, "''");
}
