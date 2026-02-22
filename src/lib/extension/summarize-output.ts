export function summarizeOutput(output: string): string {
	const line = output
		.split('\n')
		.map((value) => value.trim())
		.find((value) => value.length > 0);
	if (!line) {
		return 'no output';
	}
	return line.length > 80 ? `${line.slice(0, 80)}...` : line;
}
