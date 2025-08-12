import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '@obs/logger';

import type { IProvider } from '@provider/types';
import { getProjectWraithDir } from '@util/paths';
import YAML from 'yaml';
import {
	enforceSizeThreshold,
	type OverLimitBehavior,
	type Ruleset,
	RulesetZ,
} from './loader';
import { buildEffectiveSystemPrompt, type RuleSection } from './manager';

// Utility to ensure directory and secure file permissions
function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		if (process.platform !== 'win32') {
			try {
				fs.chmodSync(dir, 0o700);
			} catch {
				// ignore best-effort
			}
		}
	}
}

function secureWriteFile(filePath: string, content: string) {
	fs.writeFileSync(filePath, content, 'utf8');
	if (process.platform !== 'win32') {
		try {
			fs.chmodSync(filePath, 0o600);
		} catch {
			// ignore best-effort
		}
	}
}

function stripCodeFences(s: string): string {
	// Remove ```json ... ``` fences if present
	const fence = /```[\s\S]*?```/g;
	const match = s.match(fence);
	if (!match) {
		return s;
	}
	// Try to find a fenced JSON block and extract it
	for (const block of match) {
		const inner = block.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '');
		try {
			JSON.parse(inner);
			return inner;
		} catch {
			//
		}
	}
	// If no parseable fenced block, fall back to first/last braces
	return s;
}

function extractJson(raw: string): unknown | null {
	const trimmed = raw.trim();
	// Try direct parse
	try {
		return JSON.parse(trimmed);
	} catch {
		// Try fenced extraction
		const defenced = stripCodeFences(trimmed);
		if (defenced !== trimmed) {
			try {
				return JSON.parse(defenced);
			} catch {
				// continue
			}
		}
		// Fallback: extract substring between first { and last }
		const first = trimmed.indexOf('{');
		const last = trimmed.lastIndexOf('}');
		if (first >= 0 && last > first) {
			const slice = trimmed.slice(first, last + 1);
			try {
				return JSON.parse(slice);
			} catch {
				return null;
			}
		}
		return null;
	}
}

export interface GenerateRulesOptions {
	maxChars?: number; // size threshold per-scope
	overLimitBehavior?: OverLimitBehavior; // summarize | reject
	retries?: number; // structured output repair attempts
}

export interface GenerateRulesDeps {
	provider: IProvider;
	signal?: AbortSignal;
}

export async function generateProjectRules(
	prompt: string,
	deps: GenerateRulesDeps,
	opts: GenerateRulesOptions = {}
): Promise<Ruleset> {
	const log = getLogger();
	const maxChars = opts.maxChars ?? 16_000;
	const behavior: OverLimitBehavior = opts.overLimitBehavior ?? 'summarize';
	const maxRetries = Math.max(0, Math.min(opts.retries ?? 1, 3)); // up to 3 retries

	const system = buildEffectiveSystemPrompt({
		defaultPrompt:
			'You are a rule writer for an AI developer CLI. Output ONLY valid JSON adhering to the schema.',
	});

	const baseInstruction = [
		'Create a JSON ruleset object conforming to this schema:',
		'{',
		'  "version": "1",',
		'  "sections": [',
		'    { "title": "Project Rules", "rules": string[] }',
		'  ]',
		'}',
		'Constraints:',
		'- Output ONLY the JSON, no explanations.',
		'- Use concise, imperative rules. Avoid repetition and meta-instructions.',
		'- Prefer project conventions and coding standards relevant to the prompt.',
		'- Limit to roughly 12–24 rules unless needed.',
	].join('\n');

	let lastError = '';
	let attempt = 0;

	// Attempt loop with simple repair on failure
	while (attempt <= maxRetries) {
		const messages =
			attempt === 0
				? [
						{ role: 'system' as const, content: system },
						{
							role: 'user' as const,
							content: `${baseInstruction}\n\nProject prompt:\n${prompt}`,
						},
					]
				: [
						{ role: 'system' as const, content: system },
						{
							role: 'user' as const,
							content: `${baseInstruction}\n\nPrevious output was invalid:\n${lastError}\n\nProject prompt:\n${prompt}\n\nReturn ONLY corrected JSON.`,
						},
					];

		let accumulated = '';
		// biome-ignore lint/nursery/noAwaitInLoop: tbd
		const result = await deps.provider.streamChat(
			{ model: 'gpt-5', messages },
			(d) => {
				if (typeof d.content === 'string') {
					accumulated += d.content;
				}
			},
			deps.signal
		);

		const json = extractJson(
			accumulated.length ? accumulated : result.content
		);
		const parsed = RulesetZ.safeParse(json);
		if (parsed.success) {
			// Enforce size threshold by summarizing/rejecting
			const sections = parsed.data.sections ?? [];
			const limited = enforceSizeThreshold(
				sections as RuleSection[],
				maxChars,
				behavior
			);
			if (limited.error) {
				throw new Error(limited.error);
			}
			return {
				version: '1',
				sections: limited.sections,
			};
		}

		lastError = parsed.error.issues
			.map((iss) => `${iss.path.join('.')}: ${iss.message}`)
			.join('; ');
		attempt++;
	}

	throw new Error(
		`Failed to generate valid ruleset after ${maxRetries + 1} attempt(s): ${lastError || 'unknown error'}`
	);
}

export function saveProjectRules(
	ruleset: Ruleset,
	opts?: { format?: 'yaml' | 'json'; projectDir?: string }
): { path: string } {
	const format = opts?.format ?? 'yaml';
	const projectDir = opts?.projectDir ?? process.cwd();
	const wraithDir = getProjectWraithDir(projectDir);
	ensureDir(wraithDir);

	const file =
		format === 'yaml'
			? path.join(wraithDir, 'project-rules.yaml')
			: path.join(wraithDir, 'project-rules.json');

	const serialized =
		format === 'yaml'
			? YAML.stringify(ruleset)
			: JSON.stringify(ruleset, null, 2);

	secureWriteFile(file, serialized);
	return { path: file };
}
