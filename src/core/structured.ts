import fs from 'node:fs';
import path from 'node:path';
import { resolveEffectiveModel } from '@models/selection';
import { OpenAIProvider } from '@provider/openai';
import type { ChatUsage, IProvider } from '@provider/types';
import { loadUserAndProjectRules } from '@rules/loader';
import {
	buildEffectiveSystemPrompt,
	getDefaultSystemPrompt,
} from '@rules/manager';
import { loadConfig } from '@store/config';
import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

export interface StructuredAskOptions {
	prompt: string;
	schemaPath: string; // file path to JSON/YAML schema
	modelFlag?: string;
	profileFlag?: string;
	/** Max repair attempts after the first try (default 1; total tries = 1 + maxAttempts) */
	maxAttempts?: number;
}

export interface StructuredAskDeps {
	provider?: IProvider;
	config?: unknown;
}

export interface StructuredAskResult {
	ok: boolean;
	data?: unknown; // validated JSON (when ok)
	text: string; // raw assistant text (for logging/debug)
	model: string;
	usage?: ChatUsage;
	timing: { startedAt: number; elapsedMs: number };
	errors?: { instancePath: string; message?: string }[]; // ajv errors when !ok
}

function isJsonExt(p: string) {
	const ext = path.extname(p).toLowerCase();
	return ext === '.json';
}

function loadSchema(schemaPath: string): unknown {
	const raw = fs.readFileSync(schemaPath, 'utf8');
	if (isJsonExt(schemaPath)) {
		return JSON.parse(raw) as unknown;
	}
	// YAML
	return YAML.parse(raw) as unknown;
}

function makeAjv() {
	const ajv = new Ajv({
		allErrors: true,
		strict: false,
		allowUnionTypes: true,
	});
	addFormats(ajv);
	return ajv;
}

function extractJson(text: string): string | null {
	// Try fenced ```json blocks first
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence?.[1]) {
		return fence[1].trim();
	}

	// Try first {...} block with a naive brace matcher
	const start = text.indexOf('{');
	if (start === -1) {
		return null;
	}
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) {
				return text.slice(start, i + 1);
			}
		}
	}
	return null;
}

function formatAjvErrors(errs: ErrorObject[] | null | undefined) {
	return (errs ?? []).map((e) => ({
		instancePath: e.instancePath,
		message: e.message,
	}));
}

/**
 * Ask the model to produce JSON conforming to a schema, validate it,
 * and try up to N repairs by feeding validation errors back.
 */
export async function runAskStructured(
	opts: StructuredAskOptions,
	deps: StructuredAskDeps = {}
): Promise<StructuredAskResult> {
	const startedAt = Date.now();
	const mergedConfig = deps.config ?? loadConfig().merged;
	const selection = resolveEffectiveModel({
		config: mergedConfig,
		explicitModel: opts.modelFlag,
		explicitProfile: opts.profileFlag,
	});
	const provider: IProvider = deps.provider ?? new OpenAIProvider();

	// Rules → system prompt
	const { userSections, projectSections } = loadUserAndProjectRules({
		config: mergedConfig,
		profileName: selection.profile,
		overLimitBehavior: 'summarize',
		maxChars: 16_000,
	});
	const systemPrompt = buildEffectiveSystemPrompt({
		defaultPrompt: getDefaultSystemPrompt(),
		userSections,
		projectSections,
	});

	// Load schema and init AJV
	const schema = loadSchema(opts.schemaPath);
	const ajv = makeAjv();
	const validate = ajv.compile(schema as unknown as object);

	// Prepare a working conversation
	const baseMessages = [
		{ role: 'system' as const, content: systemPrompt },
		{
			role: 'user' as const,
			content:
				`${opts.prompt}\n\nIMPORTANT:\n` +
				'Return ONLY a JSON object that conforms to the attached schema. Do not include commentary or code fences.',
		},
	];

	// Attempts: first + repairs
	const maxAttempts = Math.max(0, opts.maxAttempts ?? 1);
	let lastText = '';
	let lastUsage: ChatUsage | undefined;

	for (let attempt = 0; attempt <= maxAttempts; attempt++) {
		const messages =
			attempt === 0
				? baseMessages
				: [
						...baseMessages,
						{ role: 'assistant' as const, content: lastText },
						{
							role: 'user' as const,
							content:
								'Your previous output did not validate.\n' +
								`Validation errors:\n${JSON.stringify(formatAjvErrors(validate.errors), null, 2)}\n\n` +
								'Return ONLY corrected JSON that conforms to the schema.',
						},
					];

		// Use response_format json_schema when available via provider
		const res = await provider.streamChat(
			{
				model: selection.modelId,
				messages,
				temperature: 0, // determinism helps validation
				jsonSchema: schema,
			},
			() => {
				/* no streaming for structured mode */
			}
		);

		lastText = res.content ?? '';
		lastUsage = res.usage;

		// Parse best-effort JSON
		let parsed: unknown | null = null;
		try {
			parsed = JSON.parse(lastText);
		} catch {
			const ex = extractJson(lastText);
			if (ex) {
				try {
					parsed = JSON.parse(ex);
				} catch {
					parsed = null;
				}
			}
		}

		if (parsed != null && validate(parsed)) {
			const elapsedMs = Date.now() - startedAt;
			return {
				ok: true,
				data: parsed,
				text: lastText,
				model: selection.modelId,
				usage: lastUsage,
				timing: { startedAt, elapsedMs },
			};
		}
		// else: loop with feedback
	}

	// Failed after attempts
	const elapsedMs = Date.now() - startedAt;
	return {
		ok: false,
		text: lastText,
		model: selection.modelId,
		usage: lastUsage,
		timing: { startedAt, elapsedMs },
		errors: formatAjvErrors(validate.errors),
	};
}
