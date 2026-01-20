import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

export type ThreadStatus = "IDLE" | "RUNNING" | "ERROR";

/** Async operations that can be in progress */
export type OperationType = "creating" | "switching" | "merging" | "pushing" | null;

export interface Thread {
  id: string;
  branchName: string;
  createdAt: number;
  status: ThreadStatus;
  history: MessageParam[];
  lastCommitHash: string | null;
  errorMessage?: string;
  /** Current async operation in progress (switch, merge, push) */
  operation: OperationType;
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
  /** Current async operation in progress */
  operation: OperationType;
}

export interface MergeResponse {
  success: boolean;
  error?: string;
}

export interface ErrorResponse {
  error: string;
}
