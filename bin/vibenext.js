#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDevServerManager } from "../dist/server/dev-server-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTROL_PLANE_SCRIPT = join(__dirname, "..", "dist", "server", "server.js");

console.log("\n🎨 Vibe Next - Development Mode\n");
console.log("Starting Control Plane and Next.js...\n");

// Track child processes for cleanup
const processes = [];
let isCleaningUp = false;

// Create the dev server manager for Next.js
const devServerManager = createDevServerManager(process.cwd(), (msg) => console.log(msg));

// Detect package manager early
devServerManager.detectPackageManager();

// Start the Control Plane
console.log("📡 Starting Control Plane (port 3001)...");
const controlPlane = spawn("node", [CONTROL_PLANE_SCRIPT], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: { ...process.env },
});
processes.push(controlPlane);

controlPlane.on("error", (err) => {
  console.error("❌ Failed to start Control Plane:", err.message);
});

controlPlane.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    console.error(`❌ Control Plane exited with code ${code}`);
  }
  // Ensure Next.js is also terminated when control plane exits
  cleanup();
});

// Wait a moment for the control plane to start, then start Next.js
setTimeout(() => {
  // Start Next.js via the dev server manager
  const nextProcess = devServerManager.startNextDev();
  processes.push(nextProcess);

  // Start watching package.json for changes
  devServerManager.startPackageJsonWatcher();

  console.log("\n✨ Vibe Next is ready!\n");
  console.log("   📡 Control Plane: http://localhost:3001");
  console.log("   🚀 Next.js:       http://localhost:3000");
  console.log("\n   👀 Watching package.json for changes (will auto-reinstall)\n");
}, 1000);

// Cleanup function
async function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  console.log("\n🛑 Shutting down Vibe Next...\n");

  // Cleanup the dev server manager (stops watcher and Next.js)
  await devServerManager.cleanup();

  // Kill any remaining processes
  for (const proc of processes) {
    if (!proc.killed) {
      proc.kill("SIGTERM");
    }
  }
  process.exit(0);
}

// Handle termination signals
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", () => {
  for (const proc of processes) {
    if (!proc.killed) {
      proc.kill("SIGTERM");
    }
  }
});
