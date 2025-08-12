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

export function buildEffectiveSystemPrompt(
	input: BuildPromptInput = {}
): string {
	const base = (input.defaultPrompt ?? getDefaultSystemPrompt()).trim();

	if (input.override?.mode === 'replace') {
		return input.override.content.trim();
	}

	const parts: string[] = [base];

	const renderSections = (scopeLabel: string, sections?: RuleSection[]) => {
		if (!sections || sections.length === 0) {
			return;
		}
		parts.push('');
		parts.push(`## ${scopeLabel}`);
		for (const sec of sections) {
			const title = sec.title?.trim();
			if (title) {
				parts.push(`### ${title}`);
			}
			if (sec.rules?.length) {
				for (const r of sec.rules) {
					if (r && r.trim().length > 0) {
						parts.push(`- ${r.trim()}`);
					}
				}
			}
		}
	};

	// Merge order for merge mode:
	// default < user < project < per-command override
	renderSections('User Rules', input.userSections);
	renderSections('Project Rules', input.projectSections);

	if (input.override?.content && input.override.content.trim().length > 0) {
		parts.push('');
		parts.push('## Per-Command System Override');
		parts.push(input.override.content.trim());
	}

	return parts.join('\n').trim();
}
