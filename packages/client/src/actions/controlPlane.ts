"use server";

import { cookies } from "next/headers";
import type { 
  ThreadState, 
  CreateThreadResult, 
  ChatResult, 
  MergeResult,
  ActionResult 
} from "../types";

const CONTROL_PLANE_URL = process.env.VIBE_CONTROL_PLANE_URL || "http://127.0.0.1:3001";
const AUTH_COOKIE_NAME = "vibe-auth";

/**
 * Validate that the user is authenticated
 */
async function validateAuth(): Promise<{ valid: boolean; error?: string }> {
  const vibePassword = process.env.VIBE_PASSWORD;
  
  if (!vibePassword) {
    return { valid: false, error: "VIBE_PASSWORD is not configured" };
  }

  const cookieStore = await cookies();
  const authCookie = cookieStore.get(AUTH_COOKIE_NAME);
  
  if (authCookie?.value !== "authenticated") {
    return { valid: false, error: "Not authenticated" };
  }

  return { valid: true };
}

/**
 * Make a request to the control plane with error handling
 */
async function controlPlaneFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ActionResult<T>> {
  try {
    const response = await fetch(`${CONTROL_PLANE_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
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
 */
export async function createThread(): Promise<ActionResult<CreateThreadResult>> {
  const auth = await validateAuth();
  if (!auth.valid) {
    return { success: false, error: auth.error };
  }

  return controlPlaneFetch<CreateThreadResult>("/threads", {
    method: "POST",
  });
}

/**
 * Get the current state of a thread
 */
export async function getThreadState(threadId: string): Promise<ActionResult<ThreadState>> {
  const auth = await validateAuth();
  if (!auth.valid) {
    return { success: false, error: auth.error };
  }

  return controlPlaneFetch<ThreadState>(`/threads/${threadId}`);
}

/**
 * Send a chat message to a thread
 */
export async function sendPrompt(threadId: string, message: string): Promise<ActionResult<ChatResult>> {
  const auth = await validateAuth();
  if (!auth.valid) {
    return { success: false, error: auth.error };
  }

  return controlPlaneFetch<ChatResult>(`/threads/${threadId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

/**
 * Merge a thread's changes to main
 */
export async function mergeThread(threadId: string): Promise<ActionResult<MergeResult>> {
  const auth = await validateAuth();
  if (!auth.valid) {
    return { success: false, error: auth.error };
  }

  return controlPlaneFetch<MergeResult>(`/threads/${threadId}/merge`, {
    method: "POST",
  });
}

/**
 * Check if the control plane is healthy
 */
export async function checkHealth(): Promise<ActionResult<{ status: string; workingDir: string }>> {
  // Health check doesn't require auth
  return controlPlaneFetch<{ status: string; workingDir: string }>("/health");
}

/**
 * List all threads
 */
export async function listThreads(): Promise<ActionResult<ThreadState[]>> {
  const auth = await validateAuth();
  if (!auth.valid) {
    return { success: false, error: auth.error };
  }

  return controlPlaneFetch<ThreadState[]>("/threads");
}

/**
 * Switch to a different thread (checks out the branch)
 */
export async function switchThread(threadId: string): Promise<ActionResult<ThreadState>> {
  const auth = await validateAuth();
  if (!auth.valid) {
    return { success: false, error: auth.error };
  }

  return controlPlaneFetch<ThreadState>(`/threads/${threadId}/switch`, {
    method: "POST",
  });
}
