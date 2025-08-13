import type {
	ChunkEmbedding,
	ColdIndexDriver,
	RetrievedChunk,
} from '@rag/types';

/** Minimal PG client shape so we can inject a mock in tests */
type PgClientLike = {
	query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

type PgConnectFactory = (opts: {
	connectionString?: string;
	host?: string;
	port?: number;
	user?: string;
	password?: string;
	database?: string;
	ssl?: boolean | object;
}) => Promise<PgClientLike>;

export type PgDistance = 'cosine' | 'l2' | 'ip';

export interface PgVectorDriverOptions {
	connectionString?: string;
	host?: string;
	port?: number;
	user?: string;
	password?: string;
	database?: string;
	ssl?: boolean | object;

	/** schema and table names; defaults to public.wraith_chunks */
	schema?: string;
	table?: string;

	/** pgvector metric (cosine distance, euclidean (l2), or inner product) */
	distance?: PgDistance;

	/** vector dimension; inferred on first upsert if omitted */
	dim?: number;

	/** If true, create IVFFLAT index (fast ANN). Default: true */
	createAnnIndex?: boolean;

	/** For IVFFLAT: number of lists (larger -> more memory, better recall). Default: 100 */
	ivfLists?: number;

	/** Optional injectable connector for tests */
	connectImpl?: PgConnectFactory;
}

const DEF: Required<
	Pick<
		PgVectorDriverOptions,
		'schema' | 'table' | 'distance' | 'createAnnIndex' | 'ivfLists'
	>
> = {
	schema: 'public',
	table: 'wraith_chunks',
	distance: 'cosine',
	createAnnIndex: true,
	ivfLists: 100,
};

function opFor(distance: PgDistance): {
	op: string;
	opclass: string;
	toSimilarity: (distance: number) => number;
} {
	switch (distance) {
		case 'cosine':
			// <=> returns cosine distance in [0,2]; typical normalized vectors -> [0,2], with 0 == identical
			return {
				op: '<=>',
				opclass: 'vector_cosine_ops',
				toSimilarity: (d) => 1 - d,
			};
		case 'ip':
			// <#> returns NEGATIVE inner product; smaller is better; sim = -distance
			return {
				op: '<#>',
				opclass: 'vector_ip_ops',
				toSimilarity: (d) => -d,
			};
		default:
			// <-> returns euclidean distance; convert to [0,1) via 1/(1+d)
			return {
				op: '<->',
				opclass: 'vector_l2_ops',
				toSimilarity: (d) => 1 / (1 + d),
			};
	}
}

function vecToPgLiteral(vec: number[]): string {
	// pgvector accepts text form: '[1,2,3]'
	return `[${vec.join(',')}]`;
}

function parsePgVector(v: unknown): number[] {
	if (Array.isArray(v)) {
		return v.map((x) => Number(x));
	}
	if (typeof v === 'string') {
		const s = v.trim().replace(/^\[/, '').replace(/\]$/, '');
		if (!s) {
			return [];
		}
		return s.split(',').map((t) => Number(t.trim()));
	}
	return [];
}

export class PgVectorDriver implements ColdIndexDriver {
	private opts: PgVectorDriverOptions;
	private client?: PgClientLike;
	private haveTable = false;
	private dim?: number;

	constructor(opts: PgVectorDriverOptions = {}) {
		this.opts = { ...DEF, ...opts };
		if (typeof this.opts.dim === 'number' && this.opts.dim > 0) {
			this.dim = this.opts.dim;
		}
	}

	async init(): Promise<void> {
		if (!this.client) {
			const mk = this.opts.connectImpl ?? (await this.lazyLoadPg());
			this.client = await mk({
				connectionString:
					this.opts.connectionString ??
					process.env.DATABASE_URL ??
					process.env.PGURL ??
					undefined,
				host: this.opts.host,
				port: this.opts.port,
				user: this.opts.user,
				password: this.opts.password,
				database: this.opts.database,
				ssl: this.opts.ssl,
			});
		}
		if (!this.haveTable) {
			// Probe table existence; if it fails, we'll lazily create on first upsert
			try {
				await this.client.query(
					'SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2',
					[this.opts.schema, this.opts.table]
				);
				this.haveTable = true; // probe succeeded either way (no throw)
			} catch {
				this.haveTable = false;
			}
		}
	}

	async upsert(chunks: ChunkEmbedding[]): Promise<number> {
		if (!chunks.length) {
			return 0;
		}
		await this.init();

		// Ensure schema/table if needed (and infer dim if missing)
		const dim = this.dim ?? chunks[0].dim ?? chunks[0].vector.length;
		if (!this.haveTable) {
			await this.ensureSchema(dim);
		}
		this.dim = dim;

		const { schema, table } = this.opts;
		const rows = chunks.map((c) => [
			c.id,
			vecToPgLiteral(c.vector),
			c.model,
			c.filePath,
			c.startLine,
			c.endLine,
			c.dim,
			c.tokensEstimated,
		]);

		const text = `
            INSERT INTO "${schema}"."${table}" (id, vector, model, "filePath", "startLine", "endLine", dim, "tokensEstimated")
            VALUES ${rows.map((_, i) => `($${i * 8 + 1}, $${i * 8 + 2}::vector, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`).join(',')}
            ON CONFLICT (id) DO UPDATE SET
                vector = EXCLUDED.vector,
                model = EXCLUDED.model,
                "filePath" = EXCLUDED."filePath",
                "startLine" = EXCLUDED."startLine",
                "endLine" = EXCLUDED."endLine",
                dim = EXCLUDED.dim,
                "tokensEstimated" = EXCLUDED."tokensEstimated";
        `;

		const params = rows.flat();
		await this.client?.query(text, params);
		return rows.length;
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
		const { schema, table } = this.opts;

		// If table doesn't exist yet, just return empty
		if (!this.haveTable) {
			return [];
		}

		const { op, toSimilarity } = opFor(this.opts.distance ?? 'cosine');
		const limit = Math.max(1, opts.topK ?? 8);

		const where =
			typeof opts.modelFilter === 'string' ? 'WHERE model = $2' : '';

		const text = `
            SELECT id, model, "filePath", "startLine", "endLine", dim, "tokensEstimated",
                    vector,
                    (vector ${op} $1::vector) AS d
                FROM "${schema}"."${table}"
                ${where}
                ORDER BY d ASC
                LIMIT $${where ? 3 : 2};
        `;

		const params: unknown[] = [vecToPgLiteral(queryVector)];
		if (where) {
			params.push(opts.modelFilter);
		}
		params.push(limit);

		let rows: unknown[] = [];
		try {
			const res = await this.client?.query(text, params);
			rows = res?.rows ?? [];
		} catch {
			// If the table truly doesn't exist (e.g., init race), act like empty
			return [];
		}

		const out: RetrievedChunk[] = [];
		for (const r of rows) {
			const distance = Number(r.d ?? r.distance ?? 0);
			const score = toSimilarity(distance);
			if (
				typeof opts.scoreThreshold === 'number' &&
				score < opts.scoreThreshold
			) {
				continue;
			}

			const vec = parsePgVector(r.vector);
			const id = String(r.id);
			const model = String(r.model ?? '');
			const filePath = String(r.filePath ?? r.filepath ?? '');
			const startLine = Number(r.startLine ?? r.startline ?? 1);
			const endLine = Number(r.endLine ?? r.endline ?? 1);
			const dim = Number(r.dim ?? vec.length ?? 0);
			const tokensEstimated = Number(
				r.tokensEstimated ?? r.tokensestimated ?? 0
			);

			out.push({
				score,
				chunk: {
					id,
					model,
					filePath,
					startLine,
					endLine,
					dim,
					vector: vec,
					tokensEstimated,
					chunkRef: {
						filePath,
						startLine,
						endLine,
						chunkIndex: 0,
						chunkCount: 0,
						sha256: id,
						content: '',
						tokensEstimated,
						fileType: 'text',
					},
				} as ChunkEmbedding,
				source: 'pgvector',
			});
		}
		return out;
	}

	async deleteByIds(ids: string[]): Promise<number> {
		if (!ids?.length) {
			return 0;
		}
		await this.init();
		if (!this.haveTable) {
			return 0;
		}
		const { schema, table } = this.opts;
		const text = `DELETE FROM "${schema}"."${table}" WHERE id = ANY($1::text[])`;
		await this.client?.query(text, [ids]);
		return ids.length;
	}

	async close(): Promise<void> {
		// If we ever switch to pg.Pool with .end(), we can call it here.
	}

	private async ensureSchema(dim: number) {
		const { schema, table, createAnnIndex, ivfLists } = this.opts;
		const { opclass } = opFor(this.opts.distance ?? 'cosine');

		// Extension + table + indexes (best-effort; safe to run multiple times)
		await this.client?.query('CREATE EXTENSION IF NOT EXISTS vector;');
		await this.client?.query(`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
		await this.client?.query(
			`CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (
                id TEXT PRIMARY KEY,
                vector vector(${dim}) NOT NULL,
                model TEXT NOT NULL,
                "filePath" TEXT NOT NULL,
                "startLine" INT NOT NULL,
                "endLine" INT NOT NULL,
                dim INT NOT NULL,
                "tokensEstimated" INT NOT NULL
            );`
		);
		await this.client?.query(
			`CREATE INDEX IF NOT EXISTS "${table}_model_idx" ON "${schema}"."${table}" (model);`
		);
		if (createAnnIndex) {
			await this.client?.query(
				`CREATE INDEX IF NOT EXISTS "${table}_vector_ivfflat_idx"
                    ON "${schema}"."${table}" USING ivfflat (vector ${opclass})
                    WITH (lists = ${Math.max(1, ivfLists ?? 100)});`
			);
		}

		this.haveTable = true;
		this.dim = dim;
	}

	private async lazyLoadPg(): Promise<PgConnectFactory> {
		// dynamic import; only load when driver is used
		const pg = (await import('pg')) as {
			Pool: new (
				cfg: unknown
			) => {
				query: (
					text: string,
					params?: unknown[]
				) => Promise<{ rows: unknown[] }>;
			};
		};
		return async (opts) => {
			const Pool = pg.Pool;
			const pool = new Pool({
				connectionString: opts.connectionString,
				host: opts.host,
				port: opts.port,
				user: opts.user,
				password: opts.password,
				database: opts.database,
				ssl: opts.ssl,
			});
			// Return the subset we need
			return await Promise.resolve({
				query: (text: string, params?: unknown[]) =>
					pool.query(text, params),
			});
		};
	}
}
