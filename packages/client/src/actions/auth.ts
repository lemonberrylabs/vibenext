"use server";

import { cookies } from "next/headers";

const AUTH_COOKIE_NAME = "vibe-auth";
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

/**
 * Verify the password and set auth cookie
 */
export async function authenticate(password: string): Promise<{ success: boolean; error?: string }> {
  const vibePassword = process.env.VIBE_PASSWORD;

  if (!vibePassword) {
    return { 
      success: false, 
      error: "VIBE_PASSWORD is not configured. Add it to your .env.local file." 
    };
  }

  if (password !== vibePassword) {
    return { success: false, error: "Invalid password" };
  }

  // Set HTTP-only auth cookie
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  return { success: true };
}

/**
 * Check if the user is authenticated
 */
export async function checkAuth(): Promise<{ authenticated: boolean; configured: boolean }> {
  const vibePassword = process.env.VIBE_PASSWORD;
  
  if (!vibePassword) {
    return { authenticated: false, configured: false };
  }

  const cookieStore = await cookies();
  const authCookie = cookieStore.get(AUTH_COOKIE_NAME);
  
  return { 
    authenticated: authCookie?.value === "authenticated",
    configured: true 
  };
}

/**
 * Log out by clearing the auth cookie
 */
export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
}
