import fs from 'node:fs';
import path from 'node:path';
import { getProjectWraithDir, getUserWraithDir } from '@util/paths';
import YAML from 'yaml';

export type TemplateScope = 'project' | 'user';

export type TemplateMeta = {
	name: string; // logical name (filename without ext)
	scope: TemplateScope; // where it came from
	path: string; // absolute file path
	description?: string; // frontmatter.description or first non-empty line
	variables: string[]; // placeholders detected in content (e.g., {{name}} or ${name})
};

const EXTS = new Set(['.md', '.txt', '.tmpl']);

function templatesRoot(scope: TemplateScope): string {
	// IMPORTANT: pass process.cwd() so tests that chdir() work correctly.
	return scope === 'project'
		? path.join(getProjectWraithDir(process.cwd()), 'templates')
		: path.join(getUserWraithDir(), 'templates');
}

function isTemplateFile(p: string): boolean {
	return EXTS.has(path.extname(p).toLowerCase());
}

function readFileSafe(p: string): string | null {
	try {
		return fs.readFileSync(p, 'utf8');
	} catch {
		return null;
	}
}

function parseFrontMatter(s: string): {
	fm?: Record<string, unknown>;
	body: string;
} {
	// Basic front-matter: ---\nYAML\n---\n<body>
	if (!s.startsWith('---')) {
		return { body: s };
	}
	// tolerate CRLF too
	const end = s.indexOf('\n---', 3);
	if (end < 0) {
		return { body: s };
	}
	const header = s.slice(3, end + 1); // includes leading newline
	let fm: Record<string, unknown> | undefined;
	try {
		fm = YAML.parse(header);
	} catch {
		fm = undefined;
	}
	// Skip closing '---' + newline after it (support CRLF or LF)
	const after = s.slice(end + 4);
	const body = after.replace(/^\r?\n/, '');
	return { fm, body };
}

function extractDescription(
	fm: Record<string, unknown> | undefined,
	body: string
): string | undefined {
	if (fm && typeof fm.description === 'string' && fm.description.trim()) {
		return fm.description.trim();
	}
	const first = (
		body.split(/\r?\n/).find((l) => l.trim().length) ?? ''
	).trim();
	return first.replace(/^#+\s+/, '').replace(/^>\s+/, '') || undefined;
}

function detectVariables(s: string): string[] {
	// Supports {{name}} and ${name}; names: [a-zA-Z0-9_.-]
	const set = new Set<string>();
	for (const re of [
		/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g,
		/\$\{\s*([A-Za-z0-9_.-]+)\s*\}/g,
	]) {
		let m: RegExpExecArray | null;
		// biome-ignore lint/suspicious/noAssignInExpressions: tbd
		while ((m = re.exec(s))) {
			if (m[1]) {
				set.add(m[1]);
			}
		}
	}
	return [...set].sort();
}

function listIn(scope: TemplateScope): TemplateMeta[] {
	const root = templatesRoot(scope);
	if (!fs.existsSync(root)) {
		return [];
	}
	const entries = fs
		.readdirSync(root)
		.filter((f) => isTemplateFile(f))
		.map((f) => path.join(root, f));

	const out: TemplateMeta[] = [];
	for (const abs of entries) {
		const text = readFileSafe(abs);
		if (!text) {
			continue;
		}
		const { fm, body } = parseFrontMatter(text);
		const name = path.basename(abs, path.extname(abs));
		out.push({
			name,
			scope,
			path: abs,
			description: extractDescription(fm, body),
			variables: detectVariables(body),
		});
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** List templates from project (higher precedence) and user. If names collide, keep project version. */
export function listTemplates(): TemplateMeta[] {
	const proj = listIn('project');
	const user = listIn('user');
	const merged = [...proj];
	for (const t of user) {
		if (!merged.find((x) => x.name === t.name)) {
			merged.push(t);
		}
	}
	return merged;
}

export function resolveTemplateByName(name: string): TemplateMeta | undefined {
	const all = listTemplates();
	return all.find((t) => t.name === name);
}

export function loadTemplateContent(meta: TemplateMeta): string {
	const s = readFileSafe(meta.path);
	return s ?? '';
}

/** Render with simple replacement ({{var}} and ${var}). Returns missing variables if any. */
export function renderTemplate(
	content: string,
	vars: Record<string, string>
): { output: string; missing: string[] } {
	const needed = detectVariables(content);
	const provided = new Set(Object.keys(vars));
	const missing = needed.filter((k) => !provided.has(k));

	const replaceOne = (s: string, key: string, val: string) =>
		s
			.replace(
				new RegExp(`\\{\\{\\s*${escapeReg(key)}\\s*\\}\\}`, 'g'),
				val
			)
			.replace(
				new RegExp(`\\$\\{\\s*${escapeReg(key)}\\s*\\}`, 'g'),
				val
			);

	let out = content;
	for (const [k, v] of Object.entries(vars)) {
		out = replaceOne(out, k, v);
	}
	return { output: out, missing };
}

function escapeReg(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse "--vars" like "a=1;b=2" plus repeated "--var a=1". Right-most wins on key conflicts. */
export function parseVarsArg(
	multi: string[] = [],
	singles: string[] = []
): Record<string, string> {
	const pairs: string[] = [];
	for (const chunk of multi) {
		for (const part of chunk.split(';')) {
			if (part.trim()) {
				pairs.push(part.trim());
			}
		}
	}
	for (const s of singles) {
		if (s.trim()) {
			pairs.push(s.trim());
		}
	}
	const out: Record<string, string> = {};
	for (const p of pairs) {
		const eq = p.indexOf('=');
		if (eq <= 0) {
			continue;
		}
		const k = p.slice(0, eq).trim();
		const v = p.slice(eq + 1).trim();
		if (k) {
			out[k] = v;
		}
	}
	return out;
}

// Expose roots for tests
export const __internal = {
	templatesRoot,
	isTemplateFile,
	parseFrontMatter,
	detectVariables,
	extractDescription,
};
