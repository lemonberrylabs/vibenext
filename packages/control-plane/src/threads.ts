import { v4 as uuidv4 } from "uuid";
import type { Thread, ThreadStatus } from "./types.js";
import { getGitManager } from "./git.js";
import { getAgentManager } from "./agent.js";

/**
 * In-memory thread registry
 */
const threads = new Map<string, Thread>();

/**
 * Get all threads
 */
export function getAllThreads(): Thread[] {
  return Array.from(threads.values());
}

/**
 * Get a thread by ID
 */
export function getThread(threadId: string): Thread | undefined {
  return threads.get(threadId);
}

/**
 * Create a new thread with its own Git branch
 */
export async function createThread(workingDir: string): Promise<Thread> {
  const gitManager = getGitManager(workingDir);
  const threadId = uuidv4();
  const branchName = `feat/vibe-${threadId.slice(0, 8)}`;

  // Check for uncommitted changes and handle them
  const isDirty = await gitManager.isDirty();
  if (isDirty) {
    const currentBranch = await gitManager.getCurrentBranch();
    console.log(`[Threads] Working directory is dirty on branch '${currentBranch}', auto-committing...`);
    await gitManager.autoCommit(`WIP: Auto-save before vibe thread ${threadId.slice(0, 8)}`);
  }

  // Create new branch for this thread
  console.log(`[Threads] Creating branch '${branchName}'...`);
  await gitManager.createBranch(branchName);

  const thread: Thread = {
    id: threadId,
    branchName,
    createdAt: Date.now(),
    status: "IDLE",
    history: [],
    lastCommitHash: null,
  };

  threads.set(threadId, thread);
  console.log(`[Threads] Thread ${threadId} created on branch ${branchName}`);

  return thread;
}

/**
 * Send a chat message to a thread (async processing)
 */
export async function sendMessage(
  threadId: string,
  message: string,
  workingDir: string
): Promise<ThreadStatus> {
  const thread = threads.get(threadId);
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  if (thread.status === "RUNNING") {
    throw new Error(`Thread ${threadId} is already processing a message`);
  }

  // Ensure we're on the correct branch for this thread
  const gitManager = getGitManager(workingDir);
  const currentBranch = await gitManager.getCurrentBranch();
  if (currentBranch !== thread.branchName) {
    console.log(`[Threads] Switching to branch '${thread.branchName}' for thread ${threadId}`);
    await gitManager.checkout(thread.branchName);
  }

  // Update status to RUNNING
  thread.status = "RUNNING";
  thread.errorMessage = undefined;

  // Process message asynchronously (don't await)
  const agentManager = getAgentManager(workingDir);
  agentManager
    .processMessage(thread, message, (updatedThread) => {
      // Update the thread in our registry
      threads.set(threadId, { ...updatedThread });
    })
    .catch((error) => {
      console.error(`[Threads] Error processing message for thread ${threadId}:`, error);
      thread.status = "ERROR";
      thread.errorMessage = error instanceof Error ? error.message : "Unknown error";
    });

  return thread.status;
}

/**
 * Merge a thread's branch into main and push
 */
export async function mergeThread(
  threadId: string,
  workingDir: string
): Promise<{ success: boolean; error?: string }> {
  const thread = threads.get(threadId);
  if (!thread) {
    return { success: false, error: `Thread ${threadId} not found` };
  }

  if (thread.status === "RUNNING") {
    return { success: false, error: "Cannot merge while thread is running" };
  }

  const gitManager = getGitManager(workingDir);

  try {
    // Ensure we're on the thread's branch and any changes are committed
    const currentBranch = await gitManager.getCurrentBranch();
    if (currentBranch !== thread.branchName) {
      await gitManager.checkout(thread.branchName);
    }

    const isDirty = await gitManager.isDirty();
    if (isDirty) {
      await gitManager.autoCommit("Auto: Final changes before merge");
    }

    // Switch to main and merge
    console.log(`[Threads] Checking out main...`);
    await gitManager.checkout("main");

    console.log(`[Threads] Merging ${thread.branchName} into main...`);
    await gitManager.merge(thread.branchName);

    console.log(`[Threads] Pushing to origin...`);
    await gitManager.push("origin", "main");

    console.log(`[Threads] Merge complete for thread ${threadId}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Threads] Merge failed for thread ${threadId}:`, message);
    return { success: false, error: message };
  }
}

/**
 * Delete a thread (cleanup)
 */
export function deleteThread(threadId: string): boolean {
  return threads.delete(threadId);
}

/**
 * Switch to a thread (checkout its branch)
 */
export async function switchToThread(
  threadId: string,
  workingDir: string
): Promise<Thread> {
  const thread = threads.get(threadId);
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  if (thread.status === "RUNNING") {
    throw new Error("Cannot switch to a thread that is currently running");
  }

  const gitManager = getGitManager(workingDir);

  // Check for uncommitted changes and handle them
  const isDirty = await gitManager.isDirty();
  if (isDirty) {
    const currentBranch = await gitManager.getCurrentBranch();
    console.log(`[Threads] Auto-committing changes on '${currentBranch}' before switching...`);
    await gitManager.autoCommit(`WIP: Auto-save before switching to thread ${threadId.slice(0, 8)}`);
  }

  // Switch to the thread's branch
  console.log(`[Threads] Switching to branch '${thread.branchName}'...`);
  await gitManager.checkout(thread.branchName);

  return thread;
}
