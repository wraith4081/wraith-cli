export type MergeMode = 'merge' | 'replace';

export interface RuleSection {
	title: string;
	rules: string[];
}

export interface BuildPromptInput {
	defaultPrompt?: string; // if not provided, uses getDefaultSystemPrompt()
	userSections?: RuleSection[];
	projectSections?: RuleSection[];
	override?: { content: string; mode: MergeMode };
}

export function getDefaultSystemPrompt(): string {
	return [
		'You are Wraith: a helpful developer CLI assistant.',
		'',
		'Core behavior:',
		'- Prefer concise, accurate answers optimized for terminals.',
		'- Show commands and code in fenced blocks (```), with minimal prose.',
		'- When a command could be destructive, mention safeguards or flags.',
		'- Use portable, cross-platform guidance when possible; note OS-specific differences briefly.',
		'- If information is uncertain, state assumptions and suggest how to verify.',
		'- Use readable Markdown in TTY-friendly style (no heavy formatting).',
	].join('\n');
}

export type RulesSection = { title: string; content: string };

// Accept *any* section shape coming from loader/tests and normalize it.
type LooseSection = Record<string, unknown>;

// Unified internal section
type NormSection = { title: string; content: string };

function normalizeSections(input: unknown): NormSection[] {
	if (!Array.isArray(input)) {
		return [];
	}
	const bulletize = (t: unknown): string => {
		const s = String(t ?? '').trim();
		if (!s) {
			return '';
		}
		// if user already provided a bullet/numbered list, keep it
		if (/^(-|\*|\d+\.)\s/.test(s)) {
			return s;
		}
		return `- ${s}`;
	};

	const out: NormSection[] = [];
	for (const s of input as LooseSection[]) {
		const title =
			typeof s.title === 'string' && s.title.trim().length > 0
				? s.title.trim()
				: 'Untitled';

		// primary content fields
		let content =
			(typeof s.content === 'string' && s.content) ||
			(typeof s.text === 'string' && s.text) ||
			(typeof s.body === 'string' && s.body) ||
			'';

		// array fallbacks -> bullet list
		if (!content) {
			const arr =
				(Array.isArray(s.lines) && s.lines) ||
				(Array.isArray(s.rules) && s.rules) ||
				(Array.isArray(s.items) && s.items) ||
				undefined;
			if (arr) {
				const bullets = arr.map(bulletize).filter(Boolean).join('\n');
				content = bullets;
			}
		}

		content = String(content ?? '').trim();
		if (title || content) {
			out.push({ title, content });
		}
	}
	return out;
}

export type SystemOverride = {
	content?: string;
	mode?: 'merge' | 'replace';
	title?: string;
};
type BuildParams =
	| {
			defaultPrompt?: string;
			// accept whatever the loader provides; we normalize
			userSections?: unknown;
			projectSections?: unknown;
			systemOverride?: SystemOverride;
			// legacy compatibility:
			overrideTitle?: string;
			overrideContent?: string;
	  }
	| string
	| undefined;

export function buildEffectiveSystemPrompt(params?: BuildParams): string {
	// default base prompt
	const base =
		typeof params === 'string'
			? params
			: (params?.defaultPrompt ?? getDefaultSystemPrompt());

	// normalize sections (works with your existing RuleSection shape)
	const userSections = normalizeSections(
		typeof params === 'string' ? [] : params?.userSections
	);
	const projectSections = normalizeSections(
		typeof params === 'string' ? [] : params?.projectSections
	);

	// override (supports both new + legacy fields)
	let override: SystemOverride | undefined;
	if (typeof params !== 'string' && params) {
		if (params.systemOverride) {
			override = params.systemOverride;
		} else if (params.overrideContent) {
			override = {
				content: params.overrideContent,
				title: params.overrideTitle,
				mode: 'merge',
			};
		}
	}

	const overrideContent = override?.content?.trim();
	const overrideMode = override?.mode ?? 'merge';
	const overrideTitle = (
		override?.title ?? 'Per-Command System Override'
	).trim();

	// replace mode => return only the override text (tests expect exact equality)
	if (overrideMode === 'replace' && overrideContent) {
		return overrideContent;
	}

	const parts: string[] = [];
	parts.push(base.trim());

	if (userSections.length > 0) {
		parts.push('\n## User Rules');
		for (const s of userSections) {
			if (s.content) {
				parts.push(`\n### ${s.title}\n${s.content}`);
			}
		}
	}

	if (projectSections.length > 0) {
		parts.push('\n## Project Rules');
		for (const s of projectSections) {
			if (s.content) {
				parts.push(`\n### ${s.title}\n${s.content}`);
			}
		}
	}

	if (overrideContent) {
		parts.push(`\n## ${overrideTitle}\n${overrideContent}`);
	}

	return parts
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
