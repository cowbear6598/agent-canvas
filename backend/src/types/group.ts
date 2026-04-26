export type GroupType = "command";

export const GROUP_TYPES = {
  COMMAND: "command",
} as const;

export interface Group {
  id: string;
  name: string;
  type: GroupType;
}
