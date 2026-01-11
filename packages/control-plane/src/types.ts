import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";

export type ThreadStatus = "IDLE" | "RUNNING" | "ERROR";

export interface Thread {
  id: string;
  branchName: string;
  createdAt: number;
  status: ThreadStatus;
  history: MessageParam[];
  lastCommitHash: string | null;
  errorMessage?: string;
}

export interface CreateThreadResponse {
  threadId: string;
  branchName: string;
  status: ThreadStatus;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  status: ThreadStatus;
}

export interface ThreadStateResponse {
  id: string;
  branchName: string;
  createdAt: number;
  status: ThreadStatus;
  history: MessageParam[];
  lastCommitHash: string | null;
  errorMessage?: string;
}

export interface MergeResponse {
  success: boolean;
  error?: string;
}

export interface ErrorResponse {
  error: string;
}
