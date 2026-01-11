import { v4 as uuidv4 } from "uuid";
import type { Thread, ThreadStatus } from "./types";
import { getGitManager } from "./git";
import { getAgentManager } from "./agent";

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
 * 
 * Returns IMMEDIATELY with the new thread (operation: "creating").
 * Git branch creation happens in background.
 * Client should poll to see when operation completes.
 */
export function createThread(workingDir: string): Thread {
  const threadId = uuidv4();
  const branchName = `feat/vibe-${threadId.slice(0, 8)}`;

  // Create thread record immediately with "creating" operation
  const thread: Thread = {
    id: threadId,
    branchName,
    createdAt: Date.now(),
    status: "IDLE",
    history: [],
    lastCommitHash: null,
    operation: "creating",
  };

  threads.set(threadId, thread);
  console.log(`[Threads] Thread ${threadId} registered, creating branch '${branchName}' in background...`);

  // Do git operations in background
  createThreadAsync(threadId, thread, branchName, workingDir);

  return thread;
}

async function createThreadAsync(
  threadId: string,
  thread: Thread,
  branchName: string,
  workingDir: string
): Promise<void> {
  const gitManager = getGitManager(workingDir);

  try {
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

    // Mark creation complete
    thread.operation = null;
    threads.set(threadId, { ...thread });
    console.log(`[Threads] Thread ${threadId} ready on branch ${branchName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Threads] Failed to create thread ${threadId}:`, message);
    thread.operation = null;
    thread.status = "ERROR";
    thread.errorMessage = message;
    threads.set(threadId, { ...thread });
  }
}

/**
 * Send a chat message to a thread (async processing)
 * 
 * IMPORTANT: This function returns IMMEDIATELY with RUNNING status.
 * All work (branch checkout, agent processing) happens in the background.
 * This prevents blocking the HTTP response while files change,
 * which could cause issues with Next.js HMR.
 */
export function sendMessage(
  threadId: string,
  message: string,
  workingDir: string
): ThreadStatus {
  const thread = threads.get(threadId);
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  if (thread.status === "RUNNING") {
    throw new Error(`Thread ${threadId} is already processing a message`);
  }

  // Update status to RUNNING immediately
  thread.status = "RUNNING";
  thread.errorMessage = undefined;

  // Do ALL work asynchronously - including branch checkout
  // This ensures the HTTP response returns before any file changes
  processMessageAsync(threadId, thread, message, workingDir);

  return thread.status;
}

/**
 * Internal async function that does the actual work
 * Runs completely in the background after HTTP response is sent
 */
async function processMessageAsync(
  threadId: string,
  thread: Thread,
  message: string,
  workingDir: string
): Promise<void> {
  try {
    // First, ensure we're on the correct branch
    const gitManager = getGitManager(workingDir);
    const currentBranch = await gitManager.getCurrentBranch();
    if (currentBranch !== thread.branchName) {
      console.log(`[Threads] Switching to branch '${thread.branchName}' for thread ${threadId}`);
      await gitManager.checkout(thread.branchName);
    }

    // Now run the agent
    const agentManager = getAgentManager(workingDir);
    await agentManager.processMessage(thread, message, (updatedThread) => {
      // Update the thread in our registry
      threads.set(threadId, { ...updatedThread });
    });
  } catch (error) {
    console.error(`[Threads] Error processing message for thread ${threadId}:`, error);
    thread.status = "ERROR";
    thread.errorMessage = error instanceof Error ? error.message : "Unknown error";
    threads.set(threadId, { ...thread });
  }
}

/**
 * Merge a thread's branch into main and push
 * 
 * Returns IMMEDIATELY - merge happens in background.
 * Client should poll thread state to see when operation completes.
 */
export function mergeThread(
  threadId: string,
  workingDir: string
): { success: boolean; error?: string } {
  const thread = threads.get(threadId);
  if (!thread) {
    return { success: false, error: `Thread ${threadId} not found` };
  }

  if (thread.status === "RUNNING") {
    return { success: false, error: "Cannot merge while thread is running" };
  }

  if (thread.operation) {
    return { success: false, error: `Operation '${thread.operation}' already in progress` };
  }

  // Mark operation as in progress
  thread.operation = "merging";
  threads.set(threadId, { ...thread });

  // Do the actual merge in background
  mergeThreadAsync(threadId, thread, workingDir);

  return { success: true };
}

async function mergeThreadAsync(
  threadId: string,
  thread: Thread,
  workingDir: string
): Promise<void> {
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
    
    // Clear operation and remove thread (it's been merged)
    thread.operation = null;
    threads.delete(threadId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Threads] Merge failed for thread ${threadId}:`, message);
    thread.operation = null;
    thread.status = "ERROR";
    thread.errorMessage = message;
    threads.set(threadId, { ...thread });
  }
}

/**
 * Delete a thread (cleanup)
 */
export function deleteThread(threadId: string): boolean {
  return threads.delete(threadId);
}

/**
 * Push a thread's branch to remote
 * 
 * Returns IMMEDIATELY - push happens in background.
 * Client should poll thread state to see when operation completes.
 */
export function pushThread(
  threadId: string,
  workingDir: string
): { success: boolean; error?: string } {
  const thread = threads.get(threadId);
  if (!thread) {
    return { success: false, error: `Thread ${threadId} not found` };
  }

  if (thread.status === "RUNNING") {
    return { success: false, error: "Cannot push while thread is running" };
  }

  if (thread.operation) {
    return { success: false, error: `Operation '${thread.operation}' already in progress` };
  }

  // Mark operation as in progress
  thread.operation = "pushing";
  threads.set(threadId, { ...thread });

  // Do the actual push in background
  pushThreadAsync(threadId, thread, workingDir);

  return { success: true };
}

async function pushThreadAsync(
  threadId: string,
  thread: Thread,
  workingDir: string
): Promise<void> {
  const gitManager = getGitManager(workingDir);

  try {
    // Ensure we're on the thread's branch
    const currentBranch = await gitManager.getCurrentBranch();
    if (currentBranch !== thread.branchName) {
      await gitManager.checkout(thread.branchName);
    }

    // Commit any uncommitted changes first
    const isDirty = await gitManager.isDirty();
    if (isDirty) {
      await gitManager.autoCommit("Auto: Save changes before push");
      thread.lastCommitHash = await gitManager.getLatestCommitHash();
    }

    // Push to remote (will create the branch on remote if it doesn't exist)
    console.log(`[Threads] Pushing branch '${thread.branchName}' to origin...`);
    await gitManager.push("origin", thread.branchName);

    console.log(`[Threads] Push complete for thread ${threadId}`);
    thread.operation = null;
    threads.set(threadId, { ...thread });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Threads] Push failed for thread ${threadId}:`, message);
    thread.operation = null;
    thread.status = "ERROR";
    thread.errorMessage = message;
    threads.set(threadId, { ...thread });
  }
}

/**
 * Switch to a thread (checkout its branch)
 * 
 * Returns IMMEDIATELY - switch happens in background.
 * Client should poll thread state to see when operation completes.
 */
export function switchToThread(
  threadId: string,
  workingDir: string
): { success: boolean; error?: string } {
  const thread = threads.get(threadId);
  if (!thread) {
    return { success: false, error: `Thread ${threadId} not found` };
  }

  if (thread.status === "RUNNING") {
    return { success: false, error: "Cannot switch to a thread that is currently running" };
  }

  if (thread.operation) {
    return { success: false, error: `Operation '${thread.operation}' already in progress` };
  }

  // Mark operation as in progress
  thread.operation = "switching";
  threads.set(threadId, { ...thread });

  // Do the actual switch in background
  switchToThreadAsync(threadId, thread, workingDir);

  return { success: true };
}

async function switchToThreadAsync(
  threadId: string,
  thread: Thread,
  workingDir: string
): Promise<void> {
  const gitManager = getGitManager(workingDir);

  try {
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

    console.log(`[Threads] Switch complete for thread ${threadId}`);
    thread.operation = null;
    threads.set(threadId, { ...thread });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Threads] Switch failed for thread ${threadId}:`, message);
    thread.operation = null;
    thread.status = "ERROR";
    thread.errorMessage = message;
    threads.set(threadId, { ...thread });
  }
}
