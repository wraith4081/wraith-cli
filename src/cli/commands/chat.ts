import readline from 'node:readline';
import { startChatSession } from '@core/orchestrator';

export interface ChatCliOptions {
	modelFlag?: string;
	profileFlag?: string;
	// Future toggles could live here (e.g., --no-stream)
}

export async function handleChatCommand(opts: ChatCliOptions): Promise<number> {
	const session = startChatSession({
		modelFlag: opts.modelFlag,
		profileFlag: opts.profileFlag,
	});

	const rl = readline.createInterface({
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
		`chat started (model: ${session.model}${session.profile ? `, profile: ${session.profile}` : ''})\n`
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
		streaming = true;
		const detach = attachSigintForAbort();
		const res = await session.runAssistant(
			(d) => process.stdout.write(d),
			aborter.signal
		);

		if (res.notices && res.notices.length > 0) {
			// Print any notices about context trimming before ending the line
			for (const n of res.notices) {
				process.stdout.write(`\n${n}\n`);
			}
		}
		detach();
		streaming = false;
		currentAbort = null;

		// Ensure newline after streamed/aborted content
		if (!res.content.endsWith('\n')) {
			process.stdout.write('\n');
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

export function registerChatCommand(program: unknown): void {
	// biome-ignore lint/suspicious/noExplicitAny: CLI duck-typing
	const app: any = program;
	if (typeof app.command !== 'function') {
		return;
	}

	// For sade
	if (typeof app.option === 'function' && typeof app.action === 'function') {
		app.command('chat')
			.describe(
				'Interactive chat session (Ctrl+C aborts the current stream)'
			)
			.option('-m, --model <id>', 'Override model id')
			.option('-p, --profile <name>', 'Use profile defaults')
			.action(async (flags: Record<string, unknown>) => {
				const code = await handleChatCommand({
					modelFlag: toOpt(flags.model),
					profileFlag: toOpt(flags.profile),
				});
				process.exitCode = code;
			});
		return;
	}

	// For commander
	const cmd = app
		.command('chat')
		.description(
			'Interactive chat session (Ctrl+C aborts the current stream)'
		)
		.option('-m, --model <id>', 'Override model id')
		.option('-p, --profile <name>', 'Use profile defaults');

	cmd.action(async (flags: Record<string, unknown>) => {
		const code = await handleChatCommand({
			modelFlag: toOpt(flags.model),
			profileFlag: toOpt(flags.profile),
		});
		process.exitCode = code;
	});
}

function toOpt(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}
