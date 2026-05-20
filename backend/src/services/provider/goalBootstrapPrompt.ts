/**
 * Goal Runtime bootstrap prompt — 三家 provider 共用。
 *
 * 用途：當 Pod 有 Goal Runtime MCP 且為新 session（非 resume）的第一輪時，
 * 在使用者訊息前注入這段提示，引導 agent 先呼叫 Goal Runtime 確認狀態與 active todo。
 *
 * resume 時不注入，避免覆蓋 gate retry 的 nudge 指示。
 */

const GOAL_RUNTIME_BOOTSTRAP_LINES = [
  "A Goal Runtime MCP is available for this Pod.",
  "Start by calling Goal Runtime to inspect the current status and active todo.",
  "Then continue with the current active todo instead of asking for a new task.",
  "Only ask for clarification if Goal Runtime shows no actionable todo or the work is blocked.",
];

export function buildGoalRuntimeBootstrapPrompt(rawMessage: string): string {
  return [
    `User request: ${rawMessage.trim()}`,
    "",
    ...GOAL_RUNTIME_BOOTSTRAP_LINES,
  ].join("\n");
}

export function buildGoalRuntimeBootstrapContentBlock(): {
  type: "text";
  text: string;
} {
  return {
    type: "text",
    text: [
      ...GOAL_RUNTIME_BOOTSTRAP_LINES,
      "The user's request follows in the remaining content blocks of this message.",
    ].join("\n"),
  };
}
