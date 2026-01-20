import { simpleGit, type SimpleGit, type SimpleGitOptions } from "simple-git";
import { setTimeout } from "node:timers/promises";

const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 100;

/**
 * Git wrapper with exponential backoff retry logic
 * Handles .git/index.lock conflicts that may occur with file watchers
 */
export class GitManager {
  private git: SimpleGit;

  constructor(workingDir: string) {
    const options: Partial<SimpleGitOptions> = {
      baseDir: workingDir,
      binary: "git",
      maxConcurrentProcesses: 1,
      trimmed: true,
    };
    this.git = simpleGit(options);
  }

  /**
   * Execute a git operation with retry logic for lock conflicts
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined;
    let delay = INITIAL_DELAY_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        const message = lastError.message || "";

        // Check if it's a lock-related error
        if (
          message.includes("index.lock") ||
          message.includes("Unable to create") ||
          message.includes("Another git process")
        ) {
          console.warn(
            `[GitManager] ${operationName} attempt ${attempt}/${MAX_RETRIES} failed due to lock, retrying in ${delay}ms...`
          );
          await setTimeout(delay);
          delay *= 2; // Exponential backoff
          continue;
        }

        // Non-lock error, throw immediately
        throw error;
      }
    }

    throw new Error(
      `[GitManager] ${operationName} failed after ${MAX_RETRIES} attempts: ${lastError?.message}`
    );
  }

  /**
   * Check if the working directory has uncommitted changes
   */
  async isDirty(): Promise<boolean> {
    return this.withRetry(async () => {
      const status = await this.git.status();
      return !status.isClean();
    }, "isDirty");
  }

  /**
   * Get the current branch name
   */
  async getCurrentBranch(): Promise<string> {
    return this.withRetry(async () => {
      const result = await this.git.revparse(["--abbrev-ref", "HEAD"]);
      return result.trim();
    }, "getCurrentBranch");
  }

  /**
   * Auto-commit all changes with a message
   */
  async autoCommit(message: string): Promise<string | null> {
    return this.withRetry(async () => {
      const status = await this.git.status();
      if (status.isClean()) {
        return null;
      }

      await this.git.add(".");
      const result = await this.git.commit(message);
      return result.commit || null;
    }, "autoCommit");
  }

  /**
   * Stash current changes
   */
  async stash(message?: string): Promise<void> {
    return this.withRetry(async () => {
      const args = message ? ["push", "-m", message] : ["push"];
      await this.git.stash(args);
    }, "stash");
  }

  /**
   * Create and checkout a new branch from current HEAD
   */
  async createBranch(branchName: string): Promise<void> {
    return this.withRetry(async () => {
      await this.git.checkoutLocalBranch(branchName);
    }, "createBranch");
  }

  /**
   * Create and checkout a new branch from a specific base branch
   */
  async createBranchFrom(branchName: string, baseBranch: string): Promise<void> {
    return this.withRetry(async () => {
      // First checkout the base branch, then create new branch from there
      await this.git.checkout(baseBranch);
      await this.git.checkoutLocalBranch(branchName);
    }, "createBranchFrom");
  }

  /**
   * Checkout an existing branch
   */
  async checkout(branchName: string): Promise<void> {
    return this.withRetry(async () => {
      await this.git.checkout(branchName);
    }, "checkout");
  }

  /**
   * Get the latest commit hash
   */
  async getLatestCommitHash(): Promise<string | null> {
    return this.withRetry(async () => {
      try {
        const result = await this.git.revparse(["HEAD"]);
        return result.trim() || null;
      } catch {
        return null;
      }
    }, "getLatestCommitHash");
  }

  /**
   * Merge a branch into the current branch
   */
  async merge(branchName: string): Promise<void> {
    return this.withRetry(async () => {
      await this.git.merge([branchName]);
    }, "merge");
  }

  /**
   * Push changes to remote
   */
  async push(remote: string = "origin", branch?: string): Promise<void> {
    return this.withRetry(async () => {
      const currentBranch = branch || (await this.getCurrentBranch());
      await this.git.push(remote, currentBranch);
    }, "push");
  }

  /**
   * Check if a branch exists
   */
  async branchExists(branchName: string): Promise<boolean> {
    return this.withRetry(async () => {
      const branches = await this.git.branchLocal();
      return branches.all.includes(branchName);
    }, "branchExists");
  }
}

// Singleton instance - initialized with cwd
let gitManagerInstance: GitManager | null = null;

export function getGitManager(workingDir?: string): GitManager {
  if (!gitManagerInstance) {
    gitManagerInstance = new GitManager(workingDir || process.cwd());
  }
  return gitManagerInstance;
}
