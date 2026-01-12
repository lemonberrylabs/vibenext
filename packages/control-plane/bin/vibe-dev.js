#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTROL_PLANE_SCRIPT = join(__dirname, "..", "dist", "server.js");

console.log("\n🎨 Vibe Coder - Development Mode\n");
console.log("Starting Control Plane and Next.js...\n");

// Track child processes for cleanup
const processes = [];

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
  console.log("🚀 Starting Next.js (port 3000)...\n");
  
  // Note: shell: true is required for cross-platform compatibility (Windows uses npx.cmd)
  // This is safe here because the command is static and not derived from user input
  const nextDev = spawn("npx", ["next", "dev"], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env },
    shell: true,
  });
  processes.push(nextDev);

  nextDev.on("error", (err) => {
    console.error("❌ Failed to start Next.js:", err.message);
  });

  nextDev.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`❌ Next.js exited with code ${code}`);
    }
    cleanup();
  });
}, 1000);

// Cleanup function
function cleanup() {
  console.log("\n🛑 Shutting down Vibe Coder...\n");
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
