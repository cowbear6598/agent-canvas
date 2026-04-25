export type GroupType = "command" | "subAgent";

export interface Group {
  id: string;
  name: string;
  type: GroupType;
}
