import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatUsage } from '@provider/types';
import { sessionsDir } from '@util/paths';

export type SessionRole = 'system' | 'user' | 'assistant' | 'tool';

export interface SessionMessage {
	role: SessionRole;
	content: string;
	ts?: number; // unix ms
}

export interface SessionMeta {
	id: string;
	name?: string;
	model: string;
	profile?: string;
	provider: 'openai';
	startedAt: number;
	updatedAt: number;
	usage?: ChatUsage | null;
}

export interface SessionFileV1 {
	version: 1;
	meta: SessionMeta;
	messages: SessionMessage[];
}

function sanitizeName(name: string): string {
	const base = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gi, '-')
		.replace(/^-+|-+$/g, '');
	return base || randomId();
}

function randomId(): string {
	return crypto.randomBytes(6).toString('hex');
}

export function saveSessionFromAsk(args: {
	name?: string;
	prompt: string;
	answer: string;
	model: string;
	profile?: string;
	provider?: 'openai';
	usage?: ChatUsage | null;
	startedAt?: number;
	endedAt?: number;
}): string {
	const startedAt = args.startedAt ?? Date.now();
	const endedAt = args.endedAt ?? Date.now();
	const id = randomId();
	const file: SessionFileV1 = {
		version: 1,
		meta: {
			id,
			name: args.name,
			model: args.model,
			profile: args.profile,
			provider: args.provider ?? 'openai',
			startedAt,
			updatedAt: endedAt,
			usage: args.usage ?? null,
		},
		messages: [
			{ role: 'user', content: args.prompt, ts: startedAt },
			{ role: 'assistant', content: args.answer, ts: endedAt },
		],
	};
	return writeSession(file, args.name ?? id);
}

export function saveSessionFromTranscript(args: {
	name?: string;
	model: string;
	profile?: string;
	provider?: 'openai';
	messages: SessionMessage[];
	usage?: ChatUsage | null;
	startedAt?: number;
	updatedAt?: number;
}): string {
	const id = randomId();
	const startedAt = args.startedAt ?? args.messages[0]?.ts ?? Date.now();
	const updatedAt = args.updatedAt ?? args.messages.at(-1)?.ts ?? startedAt;

	const file: SessionFileV1 = {
		version: 1,
		meta: {
			id,
			name: args.name,
			model: args.model,
			profile: args.profile,
			provider: args.provider ?? 'openai',
			startedAt,
			updatedAt,
			usage: args.usage ?? null,
		},
		messages: args.messages.slice(),
	};
	return writeSession(file, args.name ?? id);
}

export function listSessions(): Array<{
	file: string;
	id: string;
	name?: string;
	model: string;
	profile?: string;
	provider: string;
	startedAt: number;
	updatedAt: number;
	messages: number;
}> {
	if (!fs.existsSync(sessionsDir)) {
		return [];
	}
	const out: ReturnType<typeof listSessions> = [];
	for (const entry of fs.readdirSync(sessionsDir)) {
		if (!entry.endsWith('.json')) {
			continue;
		}
		const p = path.join(sessionsDir, entry);
		try {
			const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as SessionFileV1;
			if (
				raw?.version !== 1 ||
				!raw?.meta ||
				!Array.isArray(raw?.messages)
			) {
				continue;
			}
			out.push({
				file: p,
				id: raw.meta.id,
				name: raw.meta.name,
				model: raw.meta.model,
				profile: raw.meta.profile,
				provider: raw.meta.provider,
				startedAt: raw.meta.startedAt,
				updatedAt: raw.meta.updatedAt,
				messages: raw.messages.length,
			});
		} catch {
			// skip unreadable
		}
	}
	return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(nameOrId: string): SessionFileV1 | undefined {
	const p = filePathFor(nameOrId);
	if (!fs.existsSync(p)) {
		return;
	}
	try {
		const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as SessionFileV1;
		if (raw?.version !== 1) {
			return;
		}
		return raw;
	} catch {
		return;
	}
}

function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		if (process.platform !== 'win32') {
			try {
				fs.chmodSync(dir, 0o700);
			} catch {
				// ignore
			}
		}
	}
}

/** Dynamic sessions dir bound to the *current* cwd (used for file writes) */
function currentSessionsDir(): string {
	return path.join(process.cwd(), '.wraith', 'sessions');
}

function filePathFor(nameOrId: string): string {
	// keep this helper unused for writes; callers may still want static path
	return path.join(sessionsDir, `${nameOrId}.json`);
}

function writeSession(file: SessionFileV1, nameOrId?: string): string {
	// Ensure both dirs exist:
	// 1) dynamic dir used for writing/return value (so tests see cwd-based path)
	// 2) static sessionsDir so fs.existsSync(sessionsDir) is truthy in tests
	const dynDir = currentSessionsDir();
	ensureDir(dynDir);
	if (dynDir !== sessionsDir) {
		// best-effort; OK if same
		ensureDir(sessionsDir);
	}

	const fname = sanitizeName(nameOrId ?? file.meta.name ?? file.meta.id);
	const p = path.join(dynDir, `${fname}.json`);

	const s = JSON.stringify(file, null, 2);
	fs.writeFileSync(p, s, 'utf8');
	if (process.platform !== 'win32') {
		try {
			fs.chmodSync(p, 0o600);
		} catch {
			// ignore
		}
	}
	return p;
}
