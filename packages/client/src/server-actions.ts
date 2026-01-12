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
  getThreadStateImpl,
  sendPromptImpl,
  mergeThreadImpl,
  pushThreadImpl,
  checkHealthImpl,
  listThreadsImpl,
  switchThreadImpl,
} from "./lib/controlPlane";
import type { ActionResult } from "./types";

const AUTH_COOKIE = "vibe-auth";

/**
 * Authenticate with the VibeCoder password.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export async function authenticate(password: string) {
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
  const { authenticated } = await checkAuth();
  if (!authenticated) {
    return { success: false, error: "Not authenticated" };
  }
  return fn();
}

// Control plane actions (auth-protected)
export async function createThread() {
  return withAuth(() => createThreadImpl());
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

// Health check doesn't need auth
export async function checkHealth() {
  return checkHealthImpl();
}
