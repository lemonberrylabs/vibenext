import { spawn, ChildProcess } from "node:child_process";
import { watch, existsSync } from "node:fs";
import { join } from "node:path";
import type { FSWatcher } from "node:fs";

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

interface DevServerManagerOptions {
  workingDir: string;
  onLog?: (message: string) => void;
}

/**
 * Manages the Next.js dev server lifecycle with:
 * - Package manager detection
 * - package.json watching for auto-reinstall
 * - Crash recovery
 */
export class DevServerManager {
  private workingDir: string;
  private nextProcess: ChildProcess | null = null;
  private packageJsonWatcher: FSWatcher | null = null;
  private isRestarting = false;
  private shouldRecover = true;
  private packageManager: PackageManager | null = null;
  private log: (message: string) => void;

  constructor(options: DevServerManagerOptions) {
    this.workingDir = options.workingDir;
    this.log = options.onLog || console.log;
  }

  /**
   * Detect which package manager is being used based on lockfiles
   */
  detectPackageManager(): PackageManager {
    if (this.packageManager) {
      return this.packageManager;
    }

    const lockfiles: Array<{ file: string; manager: PackageManager }> = [
      { file: "pnpm-lock.yaml", manager: "pnpm" },
      { file: "yarn.lock", manager: "yarn" },
      { file: "bun.lockb", manager: "bun" },
      { file: "package-lock.json", manager: "npm" },
    ];

    for (const { file, manager } of lockfiles) {
      if (existsSync(join(this.workingDir, file))) {
        this.packageManager = manager;
        this.log(`📦 Detected package manager: ${manager}`);
        return manager;
      }
    }

    // Default to npm if no lockfile found
    this.packageManager = "npm";
    this.log(`📦 No lockfile found, defaulting to: npm`);
    return "npm";
  }

  /**
   * Get the install command for the detected package manager
   */
  private getInstallCommand(): { cmd: string; args: string[] } {
    const manager = this.detectPackageManager();
    switch (manager) {
      case "pnpm":
        return { cmd: "pnpm", args: ["install"] };
      case "yarn":
        return { cmd: "yarn", args: ["install"] };
      case "bun":
        return { cmd: "bun", args: ["install"] };
      case "npm":
      default:
        return { cmd: "npm", args: ["install"] };
    }
  }

  /**
   * Get the command to start Next.js dev server
   */
  private getNextDevCommand(): { cmd: string; args: string[]; shell: boolean } {
    const manager = this.detectPackageManager();
    switch (manager) {
      case "pnpm":
        return { cmd: "pnpm", args: ["next", "dev"], shell: false };
      case "yarn":
        return { cmd: "yarn", args: ["next", "dev"], shell: false };
      case "bun":
        return { cmd: "bun", args: ["next", "dev"], shell: false };
      case "npm":
      default:
        // npm requires npx for direct binary execution
        return { cmd: "npx", args: ["next", "dev"], shell: true };
    }
  }

  /**
   * Run package install
   */
  async runInstall(): Promise<void> {
    const { cmd, args } = this.getInstallCommand();
    this.log(`📥 Running ${cmd} ${args.join(" ")}...`);

    return new Promise((resolve, reject) => {
      const installProcess = spawn(cmd, args, {
        cwd: this.workingDir,
        stdio: "inherit",
        shell: process.platform === "win32",
      });

      installProcess.on("error", (err) => {
        this.log(`❌ Install failed: ${err.message}`);
        reject(err);
      });

      installProcess.on("exit", (code) => {
        if (code === 0) {
          this.log(`✅ Install completed successfully`);
          resolve();
        } else {
          reject(new Error(`Install exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Start the Next.js dev server
   */
  startNextDev(): ChildProcess {
    const { cmd, args, shell } = this.getNextDevCommand();
    this.log(`🚀 Starting Next.js dev server (${cmd} ${args.join(" ")})...`);

    this.nextProcess = spawn(cmd, args, {
      cwd: this.workingDir,
      stdio: "inherit",
      env: { ...process.env },
      shell,
    });

    this.nextProcess.on("error", (err) => {
      this.log(`❌ Failed to start Next.js: ${err.message}`);
    });

    this.nextProcess.on("exit", (code, signal) => {
      // Only recover if we're not intentionally restarting and recovery is enabled
      if (!this.isRestarting && this.shouldRecover && code !== 0 && signal !== "SIGTERM") {
        this.log(`⚠️ Next.js exited unexpectedly (code: ${code}, signal: ${signal}). Recovering...`);
        this.recoverNextDev();
      } else if (code !== 0 && code !== null && !this.isRestarting) {
        this.log(`❌ Next.js exited with code ${code}`);
      }
    });

    return this.nextProcess;
  }

  /**
   * Stop the Next.js dev server
   */
  async stopNextDev(): Promise<void> {
    if (!this.nextProcess || this.nextProcess.killed) {
      return;
    }

    this.log(`🛑 Stopping Next.js dev server...`);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        if (this.nextProcess && !this.nextProcess.killed) {
          this.log(`⚠️ Force killing Next.js...`);
          this.nextProcess.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      this.nextProcess!.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      this.nextProcess!.kill("SIGTERM");
    });
  }

  /**
   * Restart the Next.js dev server
   */
  async restartNextDev(): Promise<ChildProcess> {
    this.isRestarting = true;
    try {
      await this.stopNextDev();
      return this.startNextDev();
    } finally {
      this.isRestarting = false;
    }
  }

  /**
   * Recover from a crash by restarting after a delay
   */
  private recoverNextDev(): void {
    this.log(`🔄 Attempting to recover Next.js in 2 seconds...`);
    setTimeout(() => {
      if (this.shouldRecover) {
        this.startNextDev();
      }
    }, 2000);
  }

  /**
   * Handle package.json changes - run install and restart
   */
  async handlePackageJsonChange(): Promise<void> {
    if (this.isRestarting) {
      this.log(`⏳ Already restarting, skipping duplicate package.json change`);
      return;
    }

    this.log(`\n📦 package.json changed! Restarting with fresh dependencies...\n`);
    this.isRestarting = true;

    try {
      // Stop the server
      await this.stopNextDev();

      // Run install
      await this.runInstall();

      // Start the server
      this.startNextDev();
    } catch (error) {
      this.log(`❌ Failed to handle package.json change: ${error instanceof Error ? error.message : String(error)}`);
      // Try to at least restart the server
      this.startNextDev();
    } finally {
      this.isRestarting = false;
    }
  }

  /**
   * Start watching package.json for changes
   */
  startPackageJsonWatcher(): void {
    const packageJsonPath = join(this.workingDir, "package.json");

    if (!existsSync(packageJsonPath)) {
      this.log(`⚠️ No package.json found at ${packageJsonPath}, skipping watcher`);
      return;
    }

    this.log(`👀 Watching package.json for changes...`);

    // Debounce to avoid multiple triggers
    let debounceTimer: NodeJS.Timeout | null = null;

    this.packageJsonWatcher = watch(packageJsonPath, (eventType) => {
      if (eventType === "change") {
        // Debounce: wait 500ms before triggering to handle rapid successive writes
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          this.handlePackageJsonChange();
        }, 500);
      }
    });

    this.packageJsonWatcher.on("error", (err) => {
      this.log(`❌ package.json watcher error: ${err.message}`);
    });
  }

  /**
   * Stop watching package.json
   */
  stopPackageJsonWatcher(): void {
    if (this.packageJsonWatcher) {
      this.packageJsonWatcher.close();
      this.packageJsonWatcher = null;
    }
  }

  /**
   * Get the current Next.js process (if any)
   */
  getNextProcess(): ChildProcess | null {
    return this.nextProcess;
  }

  /**
   * Enable or disable crash recovery
   */
  setRecoveryEnabled(enabled: boolean): void {
    this.shouldRecover = enabled;
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    this.shouldRecover = false;
    this.stopPackageJsonWatcher();
    await this.stopNextDev();
  }
}

export function createDevServerManager(workingDir: string, onLog?: (message: string) => void): DevServerManager {
  return new DevServerManager({ workingDir, onLog });
}
