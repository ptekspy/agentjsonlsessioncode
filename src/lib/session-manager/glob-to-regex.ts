export function globToRegex(globPattern: string): string {
	let pattern = globPattern.replace(/\\/g, '/');
	if (!pattern.includes('*')) {
		pattern = `${pattern.replace(/\/+$/, '')}/**`;
	}

	let result = '';
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (char === '*') {
			const next = pattern[index + 1];
			if (next === '*') {
				result += '.*';
				index += 1;
			} else {
				result += '[^/]*';
			}
			continue;
		}

		if ('\\^$+?.()|{}[]'.includes(char)) {
			result += `\\${char}`;
		} else {
			result += char;
		}
	}

	return result;
}
