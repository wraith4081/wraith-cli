import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '@obs/logger';
import type { ConfigV1 } from '@store/schema';
import { ConfigV1Z } from '@store/schema';
import { getProjectWraithDir, getUserWraithDir } from '@util/paths';
import YAML from 'yaml';
import { z } from 'zod';
import type { RuleSection } from './manager';

const RULE_FILENAMES = [
	'user-rules.yaml',
	'user-rules.yml',
	'user-rules.json',
] as const;
const PROJECT_RULE_FILENAMES = [
	'project-rules.yaml',
	'project-rules.yml',
	'project-rules.json',
] as const;

export const RuleSectionZ = z.object({
	title: z.string().min(1, 'title is required'),
	rules: z.array(z.string()).default([]),
});

export const RulesetZ = z.object({
	version: z.literal('1').optional(),
	sections: z.array(RuleSectionZ).default([]),
});

export type Ruleset = z.infer<typeof RulesetZ>;

export interface RuleLoadError {
	scope: 'user' | 'project';
	path: string;
	message: string;
	issues?: { path: string; message: string; code?: string }[];
}

export type OverLimitBehavior = 'summarize' | 'reject';

export interface LoadRulesOptions {
	config?: unknown;
	profileName?: string;
	userDir?: string; // project root for user rules dir (for tests); defaults to homedir
	projectDir?: string; // project root for project rules dir; defaults to process.cwd()
	maxChars?: number; // per-scope threshold
	overLimitBehavior?: OverLimitBehavior;
}

export function loadUserAndProjectRules(opts: LoadRulesOptions = {}): {
	userSections: RuleSection[];
	projectSections: RuleSection[];
	errors: RuleLoadError[];
	truncated: boolean; // true if any scope was summarized
} {
	const log = getLogger();
	const errors: RuleLoadError[] = [];
	let truncated = false;

	const maxChars = opts.maxChars ?? 16_000;
	const overLimit = opts.overLimitBehavior ?? 'summarize';

	const cfgParsed = opts.config ? ConfigV1Z.safeParse(opts.config) : null;
	const cfg: ConfigV1 | undefined = cfgParsed?.success
		? cfgParsed.data
		: undefined;

	// Derive rule paths; allow profile-specific overrides in config if present
	const profile = opts.profileName;
	const profileRules = profile && cfg?.profiles?.[profile]?.rules;
	const userRulesPath =
		profileRules?.userRulesPath ??
		findFirstExistingRules(
			path.join(
				opts.userDir
					? path.join(opts.userDir, '.wraith')
					: getUserWraithDir()
			),
			RULE_FILENAMES
		);
	const projectRulesPath =
		profileRules?.projectRulesPath ??
		findFirstExistingRules(
			path.join(
				opts.projectDir
					? path.join(opts.projectDir, '.wraith')
					: getProjectWraithDir()
			),
			PROJECT_RULE_FILENAMES
		);

	// Read both scopes
	const userSections = readRulesFile(userRulesPath, 'user', errors);
	const projectSections = readRulesFile(projectRulesPath, 'project', errors);

	// Enforce size threshold per scope
	const userSized = enforceSizeThreshold(userSections, maxChars, overLimit);
	if (userSized.truncated) {
		truncated = true;
	}
	const projectSized = enforceSizeThreshold(
		projectSections,
		maxChars,
		overLimit
	);
	if (projectSized.truncated) {
		truncated = true;
	}

	if (userSized.error) {
		errors.push({
			scope: 'user',
			path: userRulesPath ?? '(none)',
			message: userSized.error,
		});
	}
	if (projectSized.error) {
		errors.push({
			scope: 'project',
			path: projectRulesPath ?? '(none)',
			message: projectSized.error,
		});
	}

	// Log errors with precise paths for observability
	for (const e of errors) {
		log.error({
			msg: 'rules-load-error',
			scope: e.scope,
			path: e.path,
			error: e.message,
			issues: e.issues,
		});
	}

	return {
		userSections: userSized.sections,
		projectSections: projectSized.sections,
		errors,
		truncated,
	};
}

function findFirstExistingRules(
	baseDir: string,
	candidates: readonly string[]
): string | undefined {
	for (const name of candidates) {
		const p = path.join(baseDir, name);
		if (fs.existsSync(p)) {
			return p;
		}
	}
	return;
}

function readRulesFile(
	filePath: string | undefined,
	scope: 'user' | 'project',
	errors: RuleLoadError[]
): RuleSection[] {
	if (!filePath) {
		return [];
	}
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		const data: unknown = filePath.endsWith('.json')
			? JSON.parse(raw)
			: YAML.parse(raw);
		const parsed = RulesetZ.safeParse(data);
		if (!parsed.success) {
			const issues = parsed.error.issues.map((iss) => ({
				path: iss.path.join('.'),
				message: iss.message,
				code: iss.code,
			}));
			errors.push({
				scope,
				path: filePath,
				message: 'Invalid rules schema',
				issues,
			});
			return [];
		}
		// Map zod-parsed sections directly to RuleSection shape
		return parsed.data.sections.map((s) => ({
			title: s.title,
			rules: s.rules ?? [],
		}));
	} catch (e) {
		errors.push({
			scope,
			path: filePath,
			message: e instanceof Error ? e.message : String(e),
		});
		return [];
	}
}

function measureChars(sections: RuleSection[]): number {
	let sum = 0;
	for (const sec of sections) {
		sum += sec.title.length + 4; // header + spacing
		for (const r of sec.rules) {
			sum += r.length + 3; // "- " + newline
		}
	}
	return sum;
}

export function enforceSizeThreshold(
	sections: RuleSection[],
	maxChars: number,
	behavior: OverLimitBehavior
): { sections: RuleSection[]; truncated: boolean; error?: string } {
	const total = measureChars(sections);
	if (total <= maxChars) {
		return { sections, truncated: false };
	}
	if (behavior === 'reject') {
		return {
			sections: [],
			truncated: false,
			error: `Rules exceed size limit (${total} > ${maxChars} chars)`,
		};
	}
	// summarize: include as many rules as fit, then append an omission note
	const out: RuleSection[] = [];
	let includedChars = 0;

	for (const sec of sections) {
		const newSec: RuleSection = { title: sec.title, rules: [] };
		// cost of section title line
		const secCost = sec.title.length + 4;
		if (includedChars + secCost > maxChars) {
			break;
		}
		includedChars += secCost;

		for (const rule of sec.rules) {
			const ruleCost = rule.length + 3;
			if (includedChars + ruleCost > maxChars) {
				break;
			}
			newSec.rules.push(rule);
			includedChars += ruleCost;
		}
		out.push(newSec);
	}

	const omittedCount =
		sections.reduce((acc, s) => acc + s.rules.length, 0) -
		out.reduce((acc, s) => acc + s.rules.length, 0);

	if (omittedCount > 0) {
		// Append an omission note to the last section or create one
		if (out.length === 0) {
			out.push({ title: 'Rules (summary)', rules: [] });
		}
		const last = out.at(-1);
		last?.rules.push(
			`… ${omittedCount} additional rule(s) omitted due to size limits.`
		);
	}

	return { sections: out, truncated: true };
}
