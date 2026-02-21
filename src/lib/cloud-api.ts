export type CloudTask = {
	id: string;
	name: string;
	description?: string | null;
};

type RequestOptions = {
	baseUrl: string;
	token?: string;
};

export class CloudApiClient {
	private readonly baseUrl: string;
	private readonly token?: string;

	public constructor(options: RequestOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, '');
		this.token = options.token;
	}

	public async health(): Promise<void> {
		await this.request('GET', '/health');
	}

	public async getTasks(): Promise<CloudTask[]> {
		return this.request<CloudTask[]>('GET', '/tasks');
	}

	public async createTask(input: {
		id: string;
		name: string;
		description?: string;
	}): Promise<CloudTask> {
		return this.request<CloudTask>('POST', '/tasks', input);
	}

	public async createSession(payload: unknown): Promise<{ sessionId: string }> {
		return this.request<{ sessionId: string }>('POST', '/sessions', payload);
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (this.token) {
			headers.Authorization = `Bearer ${this.token}`;
		}

		const response = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		if (!response.ok) {
			const details = await safeReadText(response);
			throw new Error(`API ${method} ${path} failed (${response.status}): ${details}`);
		}

		if (response.status === 204) {
			return undefined as T;
		}

		const text = await response.text();
		if (!text) {
			return undefined as T;
		}

		return JSON.parse(text) as T;
	}
}

async function safeReadText(response: Response): Promise<string> {
	try {
		const txt = await response.text();
		return txt || 'no response body';
	} catch {
		return 'unable to read response body';
	}
}