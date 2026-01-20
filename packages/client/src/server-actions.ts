/**
 * Server action implementations for VibeCoder.
 * These are async functions designed to be re-exported as Next.js Server Actions.
 *
 * Usage in your app:
 * ```typescript
 * // app/actions/vibe.ts
 * "use server";
 * export * from "@vibecoder/client/server-actions";
 * ```
 */

import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import {
  createThreadImpl,
  adoptThreadImpl,
  getThreadStateImpl,
  sendPromptImpl,
  mergeThreadImpl,
  pushThreadImpl,
  checkHealthImpl,
  getCurrentBranchImpl,
  listThreadsImpl,
  switchThreadImpl,
} from "./lib/controlPlane.js";
import type { ActionResult } from "./types.js";

const AUTH_COOKIE = "vibe-auth";

/**
 * Check if running in development mode.
 * All server actions are disabled in non-development environments.
 */
function requireDevelopment(): void {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("VibeCoder server actions are only available in development mode");
  }
}

/**
 * Authenticate with the VibeCoder password.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export async function authenticate(password: string) {
  requireDevelopment();
  const expected = process.env.VIBE_PASSWORD || "";
  const passwordBuffer = Buffer.from(password);
  const expectedBuffer = Buffer.from(expected);

  // Prevent timing attacks with constant-time comparison
  const isValid =
    passwordBuffer.length === expectedBuffer.length &&
    timingSafeEqual(passwordBuffer, expectedBuffer);

  if (!isValid) {
    return { success: false, error: "Invalid password" };
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 24,
  });

  return { success: true };
}

/**
 * Check if the user is authenticated.
 * Also checks if VIBE_PASSWORD is configured.
 */
export async function checkAuth() {
  requireDevelopment();
  if (!process.env.VIBE_PASSWORD) {
    return { authenticated: false, configured: false };
  }
  const cookieStore = await cookies();
  const auth = cookieStore.get(AUTH_COOKIE);
  return { authenticated: auth?.value === "authenticated", configured: true };
}

/**
 * Wrap an action with authentication check
 */
async function withAuth<T>(
  fn: () => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  requireDevelopment();
  const { authenticated } = await checkAuth();
  if (!authenticated) {
    return { success: false, error: "Not authenticated" };
  }
  return fn();
}

// Control plane actions (auth-protected)
export async function createThread(baseBranch?: string) {
  return withAuth(() => createThreadImpl(baseBranch));
}

export async function adoptThread(branchName: string) {
  return withAuth(() => adoptThreadImpl(branchName));
}

export async function getCurrentBranch() {
  return withAuth(() => getCurrentBranchImpl());
}

export async function getThreadState(id: string) {
  return withAuth(() => getThreadStateImpl(id));
}

export async function sendPrompt(id: string, msg: string) {
  return withAuth(() => sendPromptImpl(id, msg));
}

export async function mergeThread(id: string) {
  return withAuth(() => mergeThreadImpl(id));
}

export async function pushThread(id: string) {
  return withAuth(() => pushThreadImpl(id));
}

export async function listThreads() {
  return withAuth(() => listThreadsImpl());
}

export async function switchThread(id: string) {
  return withAuth(() => switchThreadImpl(id));
}

// Health check doesn't need auth but still requires development mode
export async function checkHealth() {
  requireDevelopment();
  return checkHealthImpl();
}
