import { z } from 'zod';
export const ToolName = z.enum([
    'repo.readFile',
    'repo.search',
    'repo.listTree',
    'run_cmd',
    'apply_patch',
]);
export const ApplyPatchOperation = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('create_file'),
        path: z.string().min(1),
        diff: z.string(),
    }),
    z.object({
        type: z.literal('update_file'),
        path: z.string().min(1),
        diff: z.string().min(1).refine((s) => s.includes('@@'), 'update_file.diff must include @@ hunks'),
    }),
    z.object({
        type: z.literal('delete_file'),
        path: z.string().min(1),
    }),
]);
export const ApplyPatchArgs = z.object({
    data: z.object({
        action: z.object({
            operations: z.array(ApplyPatchOperation).min(1),
        }),
    }),
});
const RunCmdArgsSchema = z.object({
    cmd: z.literal('pnpm'),
    args: z.array(z.string()).min(1),
    cwd: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(1).max(60 * 60 * 1000).optional(),
    env: z.record(z.string()).optional(),
});
const NonEmptyNoSpaceNoDash = z
    .string()
    .min(1)
    .refine((s) => !/\s/.test(s), 'must not contain spaces')
    .refine((s) => !s.startsWith('-'), "must not start with '-'");
const PackageName = NonEmptyNoSpaceNoDash;
const FilterSelector = NonEmptyNoSpaceNoDash;
const AllowedCmdWord = z.enum(['lint', 'test', 'build']);
const InstallWord = z.enum(['i', 'install']);
export function parseAllowedRunCmd(input) {
    if (input.cmd !== 'pnpm') {
        throw new Error("run_cmd.cmd must be 'pnpm'");
    }
    const args = [...input.args];
    function takeFilterPrefix(xs) {
        if (xs.length >= 2 && xs[0] === '--filter') {
            const selector = FilterSelector.parse(xs[1]);
            return { filter: selector, rest: xs.slice(2) };
        }
        return { rest: xs };
    }
    function takeRecursivePrefix(xs) {
        if (xs.length >= 1 && xs[0] === '-r') {
            return { recursive: true, rest: xs.slice(1) };
        }
        return { rest: xs };
    }
    const filterParsed = takeFilterPrefix(args);
    if (filterParsed.filter) {
        const rest = filterParsed.rest;
        if (rest.length === 1 && AllowedCmdWord.safeParse(rest[0]).success) {
            return;
        }
        if (rest.length === 1 && InstallWord.safeParse(rest[0]).success) {
            return;
        }
        if (rest.length >= 2 && rest[0] === 'add') {
            const second = rest[1];
            const dev = second === '-D' || second === '--save-dev' || second === '--save-dev=true';
            const pkgs = rest.slice(dev ? 2 : 1);
            if (pkgs.length === 0) {
                throw new Error('pnpm add requires at least 1 package');
            }
            pkgs.forEach((p) => PackageName.parse(p));
            return;
        }
        if (rest.length >= 2 && rest[0] === 'remove') {
            rest.slice(1).forEach((p) => PackageName.parse(p));
            return;
        }
        throw new Error('run_cmd args not in allowlist (filtered)');
    }
    const recParsed = takeRecursivePrefix(args);
    if (recParsed.recursive) {
        const rest = recParsed.rest;
        if (rest.length === 1 && AllowedCmdWord.safeParse(rest[0]).success) {
            return;
        }
        throw new Error('run_cmd args not in allowlist (-r)');
    }
    if (args.length === 1 && AllowedCmdWord.safeParse(args[0]).success) {
        return;
    }
    if (args.length === 1 && InstallWord.safeParse(args[0]).success) {
        return;
    }
    if (args.length >= 2 && args[0] === 'add') {
        const second = args[1];
        const dev = second === '-D' || second === '--save-dev' || second === '--save-dev=true';
        const pkgs = args.slice(dev ? 2 : 1);
        if (pkgs.length === 0) {
            throw new Error('pnpm add requires at least 1 package');
        }
        pkgs.forEach((p) => PackageName.parse(p));
        return;
    }
    if (args.length >= 2 && args[0] === 'remove') {
        args.slice(1).forEach((p) => PackageName.parse(p));
        return;
    }
    throw new Error('run_cmd args not in allowlist');
}
const ToolCall = z.object({
    id: z.string().min(1),
    type: z.literal('function'),
    function: z.object({
        name: ToolName,
        arguments: z.string(),
    }),
});
const SystemMessage = z.object({
    role: z.literal('system'),
    content: z.string(),
});
const UserMessage = z.object({
    role: z.literal('user'),
    content: z.string(),
});
const AssistantTextMessage = z.object({
    role: z.literal('assistant'),
    content: z.string(),
});
const AssistantToolCallMessage = z.object({
    role: z.literal('assistant'),
    tool_calls: z.array(ToolCall).min(1),
});
const ToolResultMessage = z.object({
    role: z.literal('tool'),
    tool_call_id: z.string().min(1),
    content: z.string(),
});
export const TrainingMessage = z.union([
    SystemMessage,
    UserMessage,
    AssistantTextMessage,
    AssistantToolCallMessage,
    ToolResultMessage,
]);
export const TrainingRecord = z.object({
    messages: z.array(TrainingMessage).min(2),
});
export const CreateTaskBody = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
});
export const CreateSessionBody = z.object({
    taskId: z.string().min(1),
    repo: z.object({
        name: z.string().min(1),
        root: z.string().min(1),
        branch: z.string().optional(),
        remote: z.string().optional(),
    }),
    baseRef: z.string().min(7),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime(),
    metrics: z
        .object({
        filesChanged: z.number().int().min(0),
        commandsRun: z.array(z.string()),
    })
        .optional(),
    record: TrainingRecord,
    status: z.enum(['draft', 'ready']).optional(),
});
export const ExportQuery = z.object({
    taskId: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(5000).optional(),
    since: z.string().datetime().optional(),
});
export function validateTrainingRecord(record) {
    const seenCalls = new Set();
    for (const message of record.messages) {
        if (message.role === 'assistant' && 'tool_calls' in message) {
            for (const call of message.tool_calls) {
                if (seenCalls.has(call.id)) {
                    throw new Error(`Duplicate tool_call id: ${call.id}`);
                }
                seenCalls.add(call.id);
                let parsedArgs;
                try {
                    parsedArgs = JSON.parse(call.function.arguments);
                }
                catch {
                    throw new Error(`Invalid JSON arguments for tool call: ${call.id}`);
                }
                if (call.function.name === 'apply_patch') {
                    ApplyPatchArgs.parse(parsedArgs);
                }
                if (call.function.name === 'run_cmd') {
                    const runCmdArgs = RunCmdArgsSchema.parse(parsedArgs);
                    parseAllowedRunCmd(runCmdArgs);
                }
            }
        }
        if (message.role === 'tool') {
            if (!seenCalls.has(message.tool_call_id)) {
                throw new Error(`tool message references unknown tool_call_id: ${message.tool_call_id}`);
            }
        }
    }
}
//# sourceMappingURL=contracts.js.map