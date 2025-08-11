export function getArgValue(
	longName: string,
	shortName?: string
): string | undefined {
	const argv = process.argv.slice(2);
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
