const SECRET_PATTERNS = [
    /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/g,
    /(?:sk|pk)_[A-Za-z0-9]{16,}/g,
    /[A-Za-z0-9_\-]{24,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/g,
    /(api[-_ ]?key|token|secret)\s*[:=]\s*[^\s"']+/gi,
];
export function requireBearerToken(request, reply, allowedTokens) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Missing Authorization bearer token' });
        return false;
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!allowedTokens.includes(token)) {
        reply.code(401).send({ error: 'Invalid token' });
        return false;
    }
    return true;
}
export function redactSecrets(value) {
    if (typeof value === 'string') {
        let output = value;
        for (const pattern of SECRET_PATTERNS) {
            output = output.replace(pattern, '[REDACTED]');
        }
        return output;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => redactSecrets(entry));
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value).map(([k, v]) => [
            k,
            redactSecrets(v),
        ]);
        return Object.fromEntries(entries);
    }
    return value;
}
//# sourceMappingURL=security.js.map