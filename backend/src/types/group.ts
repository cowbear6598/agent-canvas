export type GroupType = "command" | "subagent";

export const GROUP_TYPES = {
  COMMAND: "command",
  SUBAGENT: "subagent",
} as const;

export interface Group {
  id: string;
  name: string;
  type: GroupType;
}
