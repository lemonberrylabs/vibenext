/**
 * Control Plane API client
 * These are the implementation functions that user's server actions should delegate to.
 * They are NOT server actions themselves - they're regular async functions.
 * 
 * SECURITY: These functions are designed for DEVELOPMENT ONLY.
 * They will refuse to work in production environments.
 */

import type { 
  ThreadState, 
  CreateThreadResult, 
  ChatResult, 
  MergeResult,
  ActionResult 
} from "../types.js";

const DEFAULT_CONTROL_PLANE_URL = "http://127.0.0.1:3001";

export interface ControlPlaneConfig {
  url?: string;
  /** 
   * Override the production check. Only use this if you REALLY know what you're doing.
   * Setting this to true in production is a SECURITY RISK.
   */
  dangerouslyAllowProduction?: boolean;
}

/**
 * Check if we're in a production environment
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Production guard - returns error result if in production
 */
function productionGuard<T>(config?: ControlPlaneConfig): ActionResult<T> | null {
  if (isProduction() && !config?.dangerouslyAllowProduction) {
    console.error(
      "[VibeCoder] SECURITY ERROR: Vibe Coder is disabled in production. " +
      "This is a development-only tool that should never be exposed in production environments."
    );
    return {
      success: false,
      error: "Vibe Coder is disabled in production for security reasons.",
    };
  }
  return null;
}

/**
 * Make a request to the control plane with error handling
 */
async function controlPlaneFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  config?: ControlPlaneConfig
): Promise<ActionResult<T>> {
  // Block in production
  const productionError = productionGuard<T>(config);
  if (productionError) return productionError;

  const baseUrl = config?.url || process.env.VIBE_CONTROL_PLANE_URL || DEFAULT_CONTROL_PLANE_URL;

  try {
    // Only set Content-Type if there's a body (Fastify rejects empty bodies with json content-type)
    const headers: Record<string, string> = { ...options.headers as Record<string, string> };
    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { 
        success: false, 
        error: (errorData as { error?: string }).error || `HTTP ${response.status}: ${response.statusText}` 
      };
    }

    const data = await response.json() as T;
    return { success: true, data };
  } catch (error) {
    // Handle connection errors (control plane not running)
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return { 
        success: false, 
        error: "Cannot connect to Vibe Coder Control Plane. Is it running?" 
      };
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Create a new thread
 * @param baseBranch - Optional base branch to create from (defaults to current branch)
 */
export async function createThreadImpl(baseBranch?: string, config?: ControlPlaneConfig): Promise<ActionResult<CreateThreadResult>> {
  return controlPlaneFetch<CreateThreadResult>("/threads", {
    method: "POST",
    body: baseBranch ? JSON.stringify({ baseBranch }) : undefined,
  }, config);
}

/**
 * Get the current state of a thread
 */
export async function getThreadStateImpl(threadId: string, config?: ControlPlaneConfig): Promise<ActionResult<ThreadState>> {
  return controlPlaneFetch<ThreadState>(`/threads/${threadId}`, {}, config);
}

/**
 * Send a chat message to a thread
 */
export async function sendPromptImpl(threadId: string, message: string, config?: ControlPlaneConfig): Promise<ActionResult<ChatResult>> {
  return controlPlaneFetch<ChatResult>(`/threads/${threadId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  }, config);
}

/**
 * Merge a thread's changes to main
 */
export async function mergeThreadImpl(threadId: string, config?: ControlPlaneConfig): Promise<ActionResult<MergeResult>> {
  return controlPlaneFetch<MergeResult>(`/threads/${threadId}/merge`, {
    method: "POST",
  }, config);
}

/**
 * Check if the control plane is healthy
 */
export async function checkHealthImpl(config?: ControlPlaneConfig): Promise<ActionResult<{ status: string; workingDir: string }>> {
  return controlPlaneFetch<{ status: string; workingDir: string }>("/health", {}, config);
}

/**
 * Get the current git branch
 */
export async function getCurrentBranchImpl(config?: ControlPlaneConfig): Promise<ActionResult<{ branch: string }>> {
  return controlPlaneFetch<{ branch: string }>("/git/current-branch", {}, config);
}

/**
 * Adopt an existing branch as a new thread (no branch creation)
 * Use this to resume work on an existing vibe branch
 */
export async function adoptThreadImpl(branchName: string, config?: ControlPlaneConfig): Promise<ActionResult<CreateThreadResult>> {
  return controlPlaneFetch<CreateThreadResult>("/threads", {
    method: "POST",
    body: JSON.stringify({ adoptBranch: branchName }),
  }, config);
}

/**
 * List all threads
 */
export async function listThreadsImpl(config?: ControlPlaneConfig): Promise<ActionResult<ThreadState[]>> {
  return controlPlaneFetch<ThreadState[]>("/threads", {}, config);
}

/**
 * Switch to a different thread (checks out the branch)
 * Returns immediately - poll thread state to see when switch completes
 */
export async function switchThreadImpl(threadId: string, config?: ControlPlaneConfig): Promise<ActionResult<MergeResult>> {
  return controlPlaneFetch<MergeResult>(`/threads/${threadId}/switch`, {
    method: "POST",
  }, config);
}

/**
 * Push a thread's branch to remote
 */
export async function pushThreadImpl(threadId: string, config?: ControlPlaneConfig): Promise<ActionResult<MergeResult>> {
  return controlPlaneFetch<MergeResult>(`/threads/${threadId}/push`, {
    method: "POST",
  }, config);
}
