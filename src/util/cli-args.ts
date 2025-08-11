export function getArgValueFrom(
	argv: string[],
	longName: string,
	shortName?: string
): string | undefined {
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === longName || (shortName && a === shortName)) {
			return argv[i + 1];
		}
		if (a.startsWith(`${longName}=`)) {
			return a.split('=', 2)[1];
		}
		if (shortName && a.startsWith(`${shortName}=`)) {
			return a.split('=', 2)[1];
		}
	}
	return;
}

export function stripStandaloneDashes(argv: string[]): string[] {
	return argv.filter((a) => a !== '--');
}
