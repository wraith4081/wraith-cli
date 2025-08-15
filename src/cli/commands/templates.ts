/** Commander-only templates command */

import {
	listTemplates,
	loadTemplateContent,
	parseVarsArg,
	renderTemplate,
	resolveTemplateByName,
} from '@util/templates';
import type { Command } from 'commander';

export function registerTemplatesCommand(program: Command) {
	const root = program
		.command('templates')
		.description('Prompt templates commands');

	// templates list
	root.command('list')
		.description(
			'List available templates (project has precedence over user)'
		)
		.option('--json', 'Output JSON')
		.action((opts: { json?: boolean }) => {
			const all = listTemplates();

			if (opts?.json) {
				process.stdout.write(
					`${JSON.stringify({ templates: all }, null, 2)}\n`
				);
				return;
			}

			if (all.length === 0) {
				process.stdout.write('No templates found.\n');
				return;
			}

			process.stdout.write('Templates:\n');
			for (const t of all) {
				const vars = t.variables.length
					? ` [vars: ${t.variables.join(', ')}]`
					: '';
				const desc = t.description ? ` — ${t.description}` : '';
				process.stdout.write(
					`- ${t.name}  (${t.scope})${desc}${vars}\n`
				);
			}
		});

	// templates render
	root.command('render')
		.description('Render a template with variables')
		.requiredOption('--template <name>', 'Template name to render')
		.option(
			'--vars <k=v;...>',
			'Semicolon-separated key=value pairs',
			(v: string, prev: string[]) => {
				return Array.isArray(prev) ? [...prev, v] : [v];
			},
			[] as string[]
		)
		.option(
			'--var <k=v>',
			'Repeatable key=value pair',
			(v: string, prev: string[]) => {
				return Array.isArray(prev) ? [...prev, v] : [v];
			},
			[] as string[]
		)
		.option('--json', 'Output JSON envelope')
		.action(
			(opts: {
				template: string;
				vars?: string[];
				var?: string[];
				json?: boolean;
			}) => {
				const meta = resolveTemplateByName(opts.template);
				if (!meta) {
					const msg = `Template not found: ${opts.template}`;
					if (opts.json) {
						process.stdout.write(
							`${JSON.stringify({ ok: false, error: { message: msg } }, null, 2)}\n`
						);
					} else {
						process.stderr.write(`${msg}\n`);
					}
					process.exitCode = 1;
					return;
				}

				const raw = loadTemplateContent(meta);
				const vars = parseVarsArg(opts.vars ?? [], opts.var ?? []);
				const { output, missing } = renderTemplate(raw, vars);

				if (missing.length > 0) {
					const msg = `Missing variables: ${missing.join(', ')}`;
					if (opts.json) {
						process.stdout.write(
							`${JSON.stringify(
								{
									ok: false,
									error: { message: msg },
									missing,
									template: {
										name: meta.name,
										scope: meta.scope,
									},
								},
								null,
								2
							)}\n`
						);
					} else {
						process.stderr.write(`${msg}\n`);
					}
					process.exitCode = 1;
					return;
				}

				if (opts.json) {
					process.stdout.write(
						`${JSON.stringify(
							{
								ok: true,
								template: {
									name: meta.name,
									scope: meta.scope,
								},
								output,
							},
							null,
							2
						)}\n`
					);
					return;
				}

				process.stdout.write(output);
				if (!output.endsWith('\n')) {
					process.stdout.write('\n');
				}
			}
		);
}
