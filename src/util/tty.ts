export function shouldUseTui(opts?: { noTui?: boolean }): boolean {
	// If explicitly disabled, don't use TUI.
	if (opts?.noTui === true) {
		return false;
	}
	// Only use TUI when stdout is a TTY.
	return Boolean(process.stdout?.isTTY);
}
