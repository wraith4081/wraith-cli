import pkg from '../../package.json' with { type: 'json' };

export const VERSION = 'version' in pkg ? (pkg.version as string) : null;

export function getBuildInfo() {
	const bunVersion =
		typeof globalThis.Bun !== 'undefined'
			? globalThis.Bun.version
			: 'unknown';
	const platform = `${process.platform} ${process.arch}`;

	const commit =
		process.env.GIT_COMMIT ||
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.GITHUB_SHA ||
		'dev';

	const buildDate = process.env.BUILD_DATE || new Date().toISOString();

	return { version: VERSION, bunVersion, platform, commit, buildDate };
}

export function formatBuildInfo() {
	const i = getBuildInfo();
	return [
		`wraith-cli v${i.version ?? '0.0.0'}`,
		`Runtime: Bun v${i.bunVersion}`,
		`Platform: ${i.platform}`,
		`Build: ${i.commit} @ ${i.buildDate}`,
	].join('\n');
}
