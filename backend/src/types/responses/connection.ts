import type { ConnectionPublic } from "../connection.js";

export interface ConnectionCreatedPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  connection?: ConnectionPublic;
  error?: string;
}

export interface ConnectionListResultPayload {
  requestId: string;
  success: boolean;
  connections?: ConnectionPublic[];
  error?: string;
}

export interface ConnectionDeletedPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  connectionId?: string;
  error?: string;
}

export interface ConnectionUpdatedPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  connection?: ConnectionPublic;
  connections?: ConnectionPublic[];
  error?: string;
}

export interface ConnectionReadyPayload {
  socketId: string;
}
