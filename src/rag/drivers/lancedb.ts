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
	vectorIndex?: boolean; // leave false; (ANN index params can be added later)
	// for testing; lets us inject a fake connect()
	connectImpl?: LanceDBConnect;
	// for testing; avoid arrow import
	buildArrowSchemaImpl?: (dim: number) => unknown;
}

const DEFAULT_TABLE = 'rag_chunks';
const DEFAULT_SUBDIR = 'lancedb';

export class LanceDBDriver implements ColdIndexDriver {
	private opts: LanceDBDriverOptions;
	private db?: LanceDB;
	private table?: LanceTable;
	private readonly dir: string;
	private readonly tableName: string;

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
				this.opts.connectImpl ??
				((await this.lazyLoadConnect()) as unknown as LanceDBConnect);
			this.db = await connect(this.dir);
		}
		if (!this.table) {
			this.table = await this.openOrCreateTable();
		}
	}

	async upsert(chunks: ChunkEmbedding[]): Promise<number> {
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

		// Prefer mergeInsert (upsert). If not available (older lib), fall back to add().
		if (typeof table?.mergeInsert === 'function') {
			await table.mergeInsert('id', rows, {
				whenMatchedUpdateAll: true,
				whenNotMatchedInsertAll: true,
			});
			return rows.length;
		}
		// naive dedupe: try a delete-and-readd strategy in a later task if needed
		return (await table?.add(rows)) ?? 0;
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

		// The LanceDB JS client returns rows that include original columns;
		// many builds also include a "_distance" or "score" field depending on config.
		return (
			res
				// biome-ignore lint/suspicious/noExplicitAny: tbd
				.map((r: any) => {
					const chunk = {
						id: String(r.id),
						filePath: String(r.filePath),
						startLine: Number(r.startLine),
						endLine: Number(r.endLine),
						model: String(r.model),
						vector: Array.isArray(r.vector) ? r.vector.slice() : [],
						dim: Number(
							r.dim ??
								(Array.isArray(r.vector) ? r.vector.length : 0)
						),
						tokensEstimated: Number(r.tokensEstimated ?? 0),
						chunkRef: {
							// minimal provenance; full ref is optional here
							filePath: String(r.filePath),
							startLine: Number(r.startLine),
							endLine: Number(r.endLine),
							chunkIndex: 0,
							chunkCount: 0,
							sha256: String(r.id),
							content: '',
							tokensEstimated: Number(r.tokensEstimated ?? 0),
							fileType: 'text',
						},
					} as ChunkEmbedding;

					// Try to read a score field the SDK may attach; otherwise undefined.
					const score: number =
						typeof r.score === 'number'
							? r.score
							: typeof r._distance === 'number'
								? 1 / (1 + r._distance)
								: undefined;

					return { chunk, score, source: 'lancedb' };
				})
				.filter((hit) =>
					typeof opts.scoreThreshold === 'number'
						? (hit.score ?? 0) >= opts.scoreThreshold
						: true
				)
		);
	}

	// TODO: typesafety
	async deleteByIds(ids: string[]): Promise<number> {
		await this.init();
		if (ids.length === 0) {
			return 0;
		}
		// delete is available on Table interface, but we kept the type lean; dynamic call:
		const anyTable = this.table;
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		if (typeof (anyTable as any)?.delete !== 'function') {
			return 0;
		}
		const list = ids.map((s) => `'${escapeSql(s)}'`).join(',');
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		await (anyTable as any)?.delete(`id IN (${list})`);
		return ids.length;
	}

	async close(): Promise<void> {
		// current JS SDK doesn’t require an explicit close; keep for symmetry
	}

	// TODO: typesafety
	private async openOrCreateTable(): Promise<LanceTable> {
		const db = this.db as LanceDB;
		try {
			return await db.openTable(this.tableName);
		} catch {
			// Create empty table with Arrow schema (vector column must be FixedSizeList(Float32))
			const buildSchema =
				this.opts.buildArrowSchemaImpl ??
				(await this.lazyBuildArrowSchema());
			// Default to 1536 so we can create a table before first insert;
			// real vectors can still be inserted if dim matches.
			const schema = buildSchema(1536);
			if (typeof db.createEmptyTable === 'function') {
				const tbl = await db.createEmptyTable(this.tableName, schema, {
					mode: 'create',
				});
				await this.maybeCreateScalarIndexes(tbl);
				return tbl;
			}
			// Fallback: create with a single dummy row, then delete it
			const dummy = makeArrowTableFallback(buildSchema, 1536);
			const tbl = await db.createTable(this.tableName, dummy);
			await this.maybeCreateScalarIndexes(tbl);
			// try to delete dummy row if delete() exists
			// biome-ignore lint/suspicious/noExplicitAny: tbd
			const anyTbl = tbl as any;
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

	private async lazyLoadConnect() {
		// dynamic import to keep runtime light unless the driver is used
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return (await import('@lancedb/lancedb')).connect;
	}

	private async lazyBuildArrowSchema(): Promise<(dim: number) => unknown> {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const arrow = await import('apache-arrow');
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
// Creates a single dummy row; caller will try to delete it afterwards.
function makeArrowTableFallback(
	buildSchema: (pdim: number) => unknown,
	dim: number
) {
	const schema = buildSchema(dim);
	return require('@lancedb/lancedb').makeArrowTable(
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
