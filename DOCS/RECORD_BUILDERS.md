// lib/record-builders.ts
import type { ApplyPatchArgs, RunCmdArgs, TrainingRecord } from "./tooling";

export function makeSystem(content: string) {
  return { role: "system" as const, content };
}

export function makeUser(content: string) {
  return { role: "user" as const, content };
}

export function makeToolCallMessage(
  callId: string,
  toolName: string,
  argsObj: unknown
) {
  return {
    role: "assistant" as const,
    tool_calls: [
      {
        id: callId,
        type: "function" as const,
        function: {
          name: toolName,
          arguments: JSON.stringify(argsObj),
        },
      },
    ],
  };
}

export function makeToolResultMessage(callId: string, content: string) {
  return { role: "tool" as const, tool_call_id: callId, content };
}

/**
 * Helper: add an apply_patch step
 */
export function addApplyPatch(
  record: TrainingRecord,
  callId: string,
  args: ApplyPatchArgs,
  toolResult: string = '{"ok":true}'
) {
  record.messages.push(makeToolCallMessage(callId, "apply_patch", args));
  record.messages.push(makeToolResultMessage(callId, toolResult));
}

/**
 * Helper: add a run_cmd step
 */
export function addRunCmd(
  record: TrainingRecord,
  callId: string,
  args: RunCmdArgs,
  toolOutput: string
) {
  record.messages.push(makeToolCallMessage(callId, "run_cmd", args));
  record.messages.push(makeToolResultMessage(callId, toolOutput));
}