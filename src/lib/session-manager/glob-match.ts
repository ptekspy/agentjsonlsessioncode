import { globToRegex } from './glob-to-regex';

export function globMatch(targetPath: string, globPattern: string): boolean {
	try {
		const regex = new RegExp(`^${globToRegex(globPattern)}$`);
		return regex.test(targetPath);
	} catch {
		return false;
	}
}
