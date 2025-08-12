import { z } from 'zod';

export const LogLevelZ = z.enum(['debug', 'info', 'warn', 'error']);
export const RenderModeZ = z.enum(['plain', 'markdown', 'ansi']);
export const ApprovalPolicyZ = z.enum(['auto', 'prompt', 'never']);
export const RAGModeZ = z.enum(['hot', 'cold', 'auto']);
export const ColdDriverZ = z.enum(['lancedb', 'qdrant', 'pgvector']);

export const IngestionConfigZ = z
	.object({
		ignore: z.object({
			useGitIgnore: z.boolean().default(true),
			patterns: z.array(z.string()).default([]),
			includeAlways: z.array(z.string()).default(['.wraith/**']),
		}),
		maxFileSize: z.number().int().positive().optional(),
		maxFiles: z.number().int().positive().optional(),
		binaryPolicy: z.enum(['skip', 'hash', 'summary']).optional(),
	})
	.partial()
	.default({
		ignore: {
			useGitIgnore: true,
			patterns: [],
			includeAlways: ['.wraith/**'],
		},
	});

export const ColdIndexConfigZ = z.object({
	driver: ColdDriverZ,
	collection: z.string().optional(),
	storeText: z.boolean().optional(),
	redactPatterns: z.array(z.string()).optional(),
	lancedb: z.object({ path: z.string().optional() }).optional(),
	qdrant: z
		.object({
			url: z.string().url(),
			apiKey: z.string().optional(),
			tls: z.boolean().optional(),
		})
		.optional(),
	pgvector: z
		.object({
			connectionString: z.string(), // e.g., postgres://user:pass@host:5432/db
			schema: z.string().optional(),
			table: z.string().optional(),
		})
		.optional(),
});

export const RAGConfigZ = z.object({
	mode: RAGModeZ,
	topK: z.number().int().positive().optional(),
	hot: z
		.object({
			maxVectors: z.number().int().positive().optional(),
			eviction: z
				.object({
					policy: z.literal('lru'),
					highWatermark: z.number().min(0).max(1).optional(),
				})
				.optional(),
		})
		.optional(),
	cold: ColdIndexConfigZ.optional(),
});

export const ToolPolicyZ = z
	.object({
		sandboxRoot: z.string().optional(),
		networkPolicy: z.enum(['on', 'off', 'prompt']).optional(),
	})
	.partial();

export const RulesPathsZ = z
	.object({
		userRulesPath: z.string().optional(),
		projectRulesPath: z.string().optional(),
	})
	.partial();

export const ProfileZ = z.object({
	name: z.string().optional(),
	model: z.string().optional(),
	temperature: z.number().min(0).max(2).optional(),
	embeddingModel: z.string().optional(),
	rag: RAGConfigZ.optional(),
	tools: ToolPolicyZ.optional(),
	rules: RulesPathsZ.optional(),
});

export const DefaultsZ = z
	.object({
		profile: z.string().optional(),
		model: z.string().optional(),
		embeddingModel: z.string().optional(),
		rag: RAGConfigZ.optional(),
		tools: ToolPolicyZ.optional(),
		approvals: ApprovalPolicyZ.optional(),
		render: RenderModeZ.optional(),
		logging: z.object({ level: LogLevelZ.optional() }).optional(),
		ingestion: IngestionConfigZ.optional(),
	})
	.partial();

export const ConfigV1Z = z.object({
	version: z.literal('1'),
	defaults: DefaultsZ.optional(),
	profiles: z.record(z.string(), ProfileZ).optional(),
});

export type ConfigV1 = z.infer<typeof ConfigV1Z>;
export type Profile = z.infer<typeof ProfileZ>;

export function explainZodError(e: unknown) {
	if (!(e instanceof z.ZodError)) {
		return [];
	}
	return e.issues.map((err) => ({
		path: err.path.join('.'),
		message: err.message,
		code: err.code,
	}));
}
