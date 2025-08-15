/** biome-ignore-all lint/suspicious/noConsole: tbd */

import { createInterface } from 'node:readline';
import { startChatSession } from '@core/orchestrator';
import { type RenderMode, renderText } from '@render/index';
import type { Command } from 'commander';

export interface ChatCliOptions {
	modelFlag?: string;
	profileFlag?: string;
	render?: RenderMode; // default 'markdown'
	systemOverride?: string; // appended to system prompt for the whole session
	instructions?: string; // persistent user instruction message (inserted once)
}

export async function handleChatCommand(opts: ChatCliOptions): Promise<number> {
	const session = startChatSession({
		modelFlag: opts.modelFlag,
		profileFlag: opts.profileFlag,
		systemOverride: opts.systemOverride,
		instructions: opts.instructions,
	});

	const render: RenderMode = opts.render ?? 'markdown';
	const streamable = render === 'markdown';

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		historySize: 1000,
		terminal: true,
	});

	let streaming = false;
	let currentAbort: AbortController | null = null;

	function ask(prompt = 'you> '): Promise<string> {
		return new Promise((resolve) =>
			rl.question(prompt, (ans) => resolve(ans))
		);
	}

	function attachSigintForAbort() {
		const onSigint = () => {
			if (streaming && currentAbort) {
				currentAbort.abort();
				process.stdout.write('\n^C (stream aborted)\n');
			} else {
				rl.close();
			}
		};
		process.once('SIGINT', onSigint);
		return () => process.off('SIGINT', onSigint);
	}

	process.stdout.write(
		`chat started (model: ${session.model}${
			session.profile ? `, profile: ${session.profile}` : ''
		}, render: ${render})\n`
	);
	process.stdout.write('Type /exit to quit.\n');

	while (true) {
		const line = (await ask()).trim();
		if (line === '' && !streaming) {
			continue;
		}
		if (/^\/(exit|quit)$/i.test(line)) {
			break;
		}

		session.addUser(line);

		const aborter = new AbortController();
		currentAbort = aborter;
		streaming = streamable;
		const detach = attachSigintForAbort();

		const res = await session.runAssistant(
			streamable ? (d) => process.stdout.write(d) : undefined,
			aborter.signal
		);
		detach();
		streaming = false;
		currentAbort = null;

		let out = res.content;
		if (!streamable) {
			out = renderText(out, render);
		}

		// newline after answer
		if (!out.endsWith('\n')) {
			out += '\n';
		}
		process.stdout.write(out);

		// Show any notices (e.g., context trimming)
		if (res.notices && res.notices.length > 0) {
			for (const n of res.notices) {
				process.stdout.write(`${n}\n`);
			}
		}

		if (res.aborted) {
			process.stdout.write(
				'(assistant turn was aborted; session kept)\n'
			);
		}
	}

	rl.close();
	return 0;
}

export function registerChatCommand(program: Command): void {
	const cmd = program
		.command('chat')
		.description(
			'Interactive chat session (Ctrl+C aborts the current stream)'
		)
		.option('-m, --model <id>', 'Override model id')
		.option('-p, --profile <name>', 'Use profile defaults')
		.option('--render <mode>', 'Rendering: plain|markdown|ansi', 'markdown')
		.option(
			'--system <text>',
			'Append a system section for the whole chat session'
		)
		.option(
			'--instructions <text>',
			'Add a persistent instruction message'
		);

	cmd.action(async (flags: Record<string, unknown>) => {
		const code = await handleChatCommand({
			modelFlag: toOpt(flags.model),
			profileFlag: toOpt(flags.profile),
			render: toRender(flags.render),
			systemOverride: toOpt(flags.system),
			instructions: toOpt(flags.instructions),
		});
		process.exitCode = code;
	});
}

function toOpt(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}
function toRender(v: unknown): RenderMode {
	const s = typeof v === 'string' ? v.toLowerCase().trim() : '';
	return s === 'plain' || s === 'ansi' ? (s as RenderMode) : 'markdown';
}
