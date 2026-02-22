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

	public async deleteSession(sessionId: string): Promise<void> {
		await this.request<void>('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
	}

	public async updateSessionRecord(
		sessionId: string,
		record: { messages: unknown[] },
	): Promise<{ sessionId: string; status: 'draft' | 'ready' }> {
		return this.request<{ sessionId: string; status: 'draft' | 'ready' }>(
			'PUT',
			`/sessions/${encodeURIComponent(sessionId)}`,
			record,
		);
	}

	public async sessionExists(sessionId: string): Promise<boolean> {
		try {
			await this.request<{ exists: true }>('GET', `/sessions/${encodeURIComponent(sessionId)}`);
			return true;
		} catch (error) {
			if (error instanceof Error && error.message.includes('(404)')) {
				return false;
			}
			throw error;
		}
	}

	public async exportTaskJsonl(params: {
		taskId: string;
		since?: string;
		limit?: number;
	}): Promise<string> {
		const query = new URLSearchParams({ taskId: params.taskId });
		if (params.since) {
			query.set('since', params.since);
		}
		if (params.limit !== undefined) {
			query.set('limit', String(params.limit));
		}

		return this.request<string>('GET', `/export.jsonl?${query.toString()}`, undefined, {
			accept: 'application/x-ndjson,application/json,text/plain',
			responseType: 'text',
		});
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
		extra?: { accept?: string; responseType?: 'json' | 'text' },
	): Promise<T> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (extra?.accept) {
			headers.Accept = extra.accept;
		}

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

		if (extra?.responseType === 'text') {
			return (await response.text()) as T;
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