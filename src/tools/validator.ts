import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

export type AjvLike = Pick<Ajv, 'compile'>;

export function makeAjv(): AjvLike {
	const ajv = new Ajv({
		strict: false, // pragmatic; we accept schemas from plugins
		allErrors: true,
		validateFormats: true,
		useDefaults: true, // allow defaulting params for tools
		coerceTypes: 'array', // coerce scalars to arrays where schema says so
	});
	addFormats(ajv);
	return ajv;
}

export function formatAjvErrors(
	errors: ErrorObject[] | null | undefined
): string[] {
	if (!errors || errors.length === 0) {
		return [];
	}
	const out: string[] = [];
	for (const e of errors) {
		const path = e.instancePath || e.schemaPath || '';
		const loc = path
			? path.replace(/^\//, '').replaceAll('/', '.')
			: '(root)';
		const msg = e.message ?? 'invalid';
		out.push(`${loc}: ${msg}`);
	}
	return out;
}
