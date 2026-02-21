// lib/tooling.ts
import { z } from "zod";

/**
 * -----------------------------
 * Tool contracts (v1)
 * -----------------------------
 */

export const ToolName = z.enum([
  "repo.readFile",
  "repo.search",
  "repo.listTree",
  "run_cmd",
  "apply_patch",
]);
export type ToolName = z.infer<typeof ToolName>;

// repo.readFile
export const RepoReadFileArgs = z.object({
  path: z.string().min(1),
});
export type RepoReadFileArgs = z.infer<typeof RepoReadFileArgs>;

// repo.search
export const RepoSearchArgs = z.object({
  query: z.string().min(1),
  path: z.string().min(1).optional(),
});
export type RepoSearchArgs = z.infer<typeof RepoSearchArgs>;

// repo.listTree
export const RepoListTreeArgs = z.object({
  path: z.string().min(1).optional(),
  maxDepth: z.number().int().min(0).max(50).optional(),
});
export type RepoListTreeArgs = z.infer<typeof RepoListTreeArgs>;

// apply_patch
export const ApplyPatchOperation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_file"),
    path: z.string().min(1),
    diff: z.string(), // full file contents (exact)
  }),
  z.object({
    type: z.literal("update_file"),
    path: z.string().min(1),
    diff: z
      .string()
      .min(1)
      .refine((s) => s.includes("@@"), "update_file.diff must include @@ hunks"),
  }),
  z.object({
    type: z.literal("delete_file"),
    path: z.string().min(1),
  }),
]);
export type ApplyPatchOperation = z.infer<typeof ApplyPatchOperation>;

export const ApplyPatchArgs = z.object({
  data: z.object({
    action: z.object({
      operations: z.array(ApplyPatchOperation).min(1),
    }),
  }),
});
export type ApplyPatchArgs = z.infer<typeof ApplyPatchArgs>;

/**
 * -----------------------------
 * run_cmd (strict allowlist v3)
 * -----------------------------
 */
export type RunCmdArgs = {
  cmd: "pnpm";
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type AllowedRunCmd =
  | { kind: "lint" | "test" | "build"; filter?: string; recursive?: boolean }
  | { kind: "install"; filter?: string }
  | {
      kind: "add";
      filter?: string;
      dev: boolean;
      packages: string[];
    }
  | { kind: "remove"; filter?: string; packages: string[] };

const NonEmptyNoSpaceNoDash = z
  .string()
  .min(1)
  .refine((s) => !/\s/.test(s), "must not contain spaces")
  .refine((s) => !s.startsWith("-"), "must not start with '-'");

const PackageName = NonEmptyNoSpaceNoDash; // keep simple v1
const FilterSelector = NonEmptyNoSpaceNoDash; // keep simple v1

const AllowedCmdWord = z.enum(["lint", "test", "build"]);
const InstallWord = z.enum(["i", "install"]);

// Canonicalize args so downstream logging/export is stable.
export function normalizeRunCmdArgs(input: RunCmdArgs): RunCmdArgs {
  return {
    cmd: input.cmd,
    args: [...input.args],
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    env: input.env,
  };
}

export function parseAllowedRunCmd(input: RunCmdArgs): AllowedRunCmd {
  if (input.cmd !== "pnpm") {
    throw new Error("run_cmd.cmd must be 'pnpm'");
  }

  const args = [...input.args];

  // Helper: parse optional "--filter <selector>" prefix
  function takeFilterPrefix(xs: string[]): { filter?: string; rest: string[] } {
    if (xs.length >= 2 && xs[0] === "--filter") {
      const selector = FilterSelector.parse(xs[1]);
      return { filter: selector, rest: xs.slice(2) };
    }
    return { rest: xs };
  }

  // Helper: parse optional "-r" prefix (recursive)
  function takeRecursivePrefix(xs: string[]): { recursive?: boolean; rest: string[] } {
    if (xs.length >= 1 && xs[0] === "-r") {
      return { recursive: true, rest: xs.slice(1) };
    }
    return { rest: xs };
  }

  // Order: allow either "--filter" OR "-r" as first flag (but not both in v1).
  const filterParsed = takeFilterPrefix(args);
  if (filterParsed.filter) {
    const rest = filterParsed.rest;

    // filtered lint/test/build
    if (rest.length === 1 && AllowedCmdWord.safeParse(rest[0]).success) {
      return { kind: rest[0] as "lint" | "test" | "build", filter: filterParsed.filter };
    }

    // filtered install
    if (rest.length === 1 && InstallWord.safeParse(rest[0]).success) {
      return { kind: "install", filter: filterParsed.filter };
    }

    // filtered add
    // pnpm --filter X add <pkg...>
    // pnpm --filter X add -D <pkg...>
    // pnpm --filter X add --save-dev <pkg...>
    if (rest.length >= 2 && rest[0] === "add") {
      const second = rest[1];
      const dev =
        second === "-D" || second === "--save-dev" || second === "--save-dev=true";
      const pkgsStartIndex = dev ? 2 : 1;
      const pkgs = rest.slice(pkgsStartIndex);
      if (pkgs.length === 0) throw new Error("pnpm add requires at least 1 package");
      pkgs.forEach((p) => PackageName.parse(p));
      return { kind: "add", filter: filterParsed.filter, dev, packages: pkgs };
    }

    // filtered remove
    if (rest.length >= 2 && rest[0] === "remove") {
      const pkgs = rest.slice(1);
      pkgs.forEach((p) => PackageName.parse(p));
      return { kind: "remove", filter: filterParsed.filter, packages: pkgs };
    }

    throw new Error("run_cmd args not in allowlist (filtered)");
  }

  const recParsed = takeRecursivePrefix(args);
  if (recParsed.recursive) {
    const rest = recParsed.rest;
    if (rest.length === 1 && AllowedCmdWord.safeParse(rest[0]).success) {
      return { kind: rest[0] as "lint" | "test" | "build", recursive: true };
    }
    throw new Error("run_cmd args not in allowlist (-r)");
  }

  // unfiltered
  if (args.length === 1 && AllowedCmdWord.safeParse(args[0]).success) {
    return { kind: args[0] as "lint" | "test" | "build" };
  }

  if (args.length === 1 && InstallWord.safeParse(args[0]).success) {
    return { kind: "install" };
  }

  if (args.length >= 2 && args[0] === "add") {
    const second = args[1];
    const dev = second === "-D" || second === "--save-dev" || second === "--save-dev=true";
    const pkgsStartIndex = dev ? 2 : 1;
    const pkgs = args.slice(pkgsStartIndex);
    if (pkgs.length === 0) throw new Error("pnpm add requires at least 1 package");
    pkgs.forEach((p) => PackageName.parse(p));
    return { kind: "add", dev, packages: pkgs };
  }

  if (args.length >= 2 && args[0] === "remove") {
    const pkgs = args.slice(1);
    pkgs.forEach((p) => PackageName.parse(p));
    return { kind: "remove", packages: pkgs };
  }

  throw new Error("run_cmd args not in allowlist");
}

/**
 * Zod schema for run_cmd tool call arguments.
 * (We validate structure here; allowlist is enforced by parseAllowedRunCmd)
 */
export const RunCmdArgsSchema = z.object({
  cmd: z.literal("pnpm"),
  args: z.array(z.string()).min(1),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(1).max(60 * 60 * 1000).optional(),
  env: z.record(z.string()).optional(),
});

/**
 * -----------------------------
 * Training record schema
 * -----------------------------
 */

export const ToolCall = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: ToolName,
    arguments: z.string(), // JSON string of args
  }),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const SystemMessage = z.object({
  role: z.literal("system"),
  content: z.string(),
});
export const UserMessage = z.object({
  role: z.literal("user"),
  content: z.string(),
});
export const AssistantTextMessage = z.object({
  role: z.literal("assistant"),
  content: z.string(),
});
export const AssistantToolCallMessage = z.object({
  role: z.literal("assistant"),
  tool_calls: z.array(ToolCall).min(1),
});
export const ToolResultMessage = z.object({
  role: z.literal("tool"),
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
export type TrainingMessage = z.infer<typeof TrainingMessage>;

export const TrainingRecord = z.object({
  messages: z.array(TrainingMessage).min(2),
});
export type TrainingRecord = z.infer<typeof TrainingRecord>;

/**
 * Optional: session wrapper you store in Postgres (jsonb).
 * record is the TrainingRecord above.
 */
export const StoredSession = z.object({
  id: z.string().uuid(),
  taskId: z.string().min(1),
  repo: z.object({
    name: z.string().min(1),
    root: z.string().min(1),
    branch: z.string().min(1).optional(),
    remote: z.string().min(1).optional(),
  }),
  baseRef: z.string().min(7),
  createdAt: z.string().datetime(),
  record: TrainingRecord,
  metrics: z
    .object({
      filesChanged: z.number().int().min(0).optional(),
      commandsRun: z.array(z.string()).optional(),
    })
    .optional(),
});
export type StoredSession = z.infer<typeof StoredSession>;