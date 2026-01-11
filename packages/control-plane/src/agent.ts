import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages.js";
import type { Thread } from "./types.js";
import { getGitManager } from "./git.js";

const SYSTEM_PROMPT = `You are a coding assistant modifying the local codebase.

IMPORTANT GUIDELINES:
- Use ls and grep to explore the codebase before making changes.
- Always run tsc or a build check if unsure before finishing.
- Make targeted, minimal changes to accomplish the user's request.
- If you encounter errors, try to fix them before giving up.
- Explain what you're doing as you go.

You have access to the filesystem and can execute bash commands.`;

/**
 * Agent manager that handles Claude interactions for a thread
 */
export class AgentManager {
  private client: Anthropic;
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.client = new Anthropic();
  }

  /**
   * Process a user message and run the agent loop
   * This method handles tool calls iteratively until the model stops
   */
  async processMessage(
    thread: Thread,
    userMessage: string,
    onUpdate: (thread: Thread) => void
  ): Promise<void> {
    // Add user message to history
    thread.history.push({
      role: "user",
      content: userMessage,
    });

    try {
      let continueLoop = true;

      while (continueLoop) {
        // Call Claude with current history
        const response = await this.client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8096,
          system: SYSTEM_PROMPT,
          tools: this.getToolDefinitions(),
          messages: thread.history,
        });

        // Extract text and tool use from response
        const assistantContent = response.content;
        
        // Add assistant response to history
        thread.history.push({
          role: "assistant",
          content: assistantContent,
        });
        onUpdate(thread);

        // Check if we need to handle tool calls
        if (response.stop_reason === "tool_use") {
          const toolResults = await this.handleToolCalls(assistantContent);
          
          // Add tool results to history
          thread.history.push({
            role: "user",
            content: toolResults,
          });
          onUpdate(thread);
        } else {
          // Model stopped without requesting tools - we're done
          continueLoop = false;
        }
      }

      // Auto-commit changes after agent completes
      const gitManager = getGitManager(this.workingDir);
      const messageSnippet = userMessage.slice(0, 50).replace(/\n/g, " ");
      const commitHash = await gitManager.autoCommit(`Auto: ${messageSnippet}`);
      
      if (commitHash) {
        thread.lastCommitHash = commitHash;
      }
      
      thread.status = "IDLE";
      onUpdate(thread);
    } catch (error) {
      console.error("[AgentManager] Error processing message:", error);
      thread.status = "ERROR";
      thread.errorMessage = error instanceof Error ? error.message : "Unknown error";
      onUpdate(thread);
      throw error;
    }
  }

  /**
   * Get tool definitions for Claude
   */
  private getToolDefinitions(): Anthropic.Tool[] {
    return [
      {
        name: "bash",
        description: "Execute a bash command in the working directory. Use this to run commands, check build status, run tests, etc.",
        input_schema: {
          type: "object" as const,
          properties: {
            command: {
              type: "string",
              description: "The bash command to execute",
            },
          },
          required: ["command"],
        },
      },
      {
        name: "read_file",
        description: "Read the contents of a file at the given path.",
        input_schema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "The path to the file to read (relative to project root)",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write content to a file at the given path. Creates the file if it doesn't exist, overwrites if it does.",
        input_schema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "The path to the file to write (relative to project root)",
            },
            content: {
              type: "string",
              description: "The content to write to the file",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "list_files",
        description: "List files and directories at the given path.",
        input_schema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "The path to list (relative to project root, defaults to '.')",
            },
          },
          required: [],
        },
      },
    ];
  }

  /**
   * Handle tool calls from Claude's response
   */
  private async handleToolCalls(
    content: ContentBlock[]
  ): Promise<Anthropic.ToolResultBlockParam[]> {
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const block of content) {
      if (block.type === "tool_use") {
        const toolResult = await this.executeTool(block.name, block.input as Record<string, unknown>);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: toolResult,
        });
      }
    }

    return results;
  }

  /**
   * Execute a single tool call
   */
  private async executeTool(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<string> {
    try {
      switch (toolName) {
        case "bash":
          return await this.executeBash(input.command as string);
        case "read_file":
          return await this.readFile(input.path as string);
        case "write_file":
          return await this.writeFile(input.path as string, input.content as string);
        case "list_files":
          return await this.listFiles((input.path as string) || ".");
        default:
          return `Error: Unknown tool '${toolName}'`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error executing ${toolName}: ${message}`;
    }
  }

  /**
   * Execute a bash command
   */
  private async executeBash(command: string): Promise<string> {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workingDir,
        timeout: 60000, // 60 second timeout
        maxBuffer: 1024 * 1024, // 1MB buffer
      });
      
      let result = "";
      if (stdout) result += stdout;
      if (stderr) result += (result ? "\n" : "") + "stderr: " + stderr;
      return result || "Command completed successfully (no output)";
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; message: string };
      let result = `Command failed: ${execError.message}`;
      if (execError.stdout) result += `\nstdout: ${execError.stdout}`;
      if (execError.stderr) result += `\nstderr: ${execError.stderr}`;
      return result;
    }
  }

  /**
   * Read a file
   */
  private async readFile(filePath: string): Promise<string> {
    const { readFile } = await import("node:fs/promises");
    const { join, isAbsolute } = await import("node:path");
    
    const fullPath = isAbsolute(filePath) ? filePath : join(this.workingDir, filePath);
    const content = await readFile(fullPath, "utf-8");
    return content;
  }

  /**
   * Write a file
   */
  private async writeFile(filePath: string, content: string): Promise<string> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join, dirname, isAbsolute } = await import("node:path");
    
    const fullPath = isAbsolute(filePath) ? filePath : join(this.workingDir, filePath);
    
    // Ensure directory exists
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
    
    return `Successfully wrote to ${filePath}`;
  }

  /**
   * List files in a directory
   */
  private async listFiles(dirPath: string): Promise<string> {
    const { readdir, stat } = await import("node:fs/promises");
    const { join, isAbsolute } = await import("node:path");
    
    const fullPath = isAbsolute(dirPath) ? dirPath : join(this.workingDir, dirPath);
    const entries = await readdir(fullPath);
    
    const results: string[] = [];
    for (const entry of entries) {
      const entryPath = join(fullPath, entry);
      const stats = await stat(entryPath);
      results.push(stats.isDirectory() ? `${entry}/` : entry);
    }
    
    return results.join("\n") || "(empty directory)";
  }
}

// Singleton instance
let agentManagerInstance: AgentManager | null = null;

export function getAgentManager(workingDir?: string): AgentManager {
  if (!agentManagerInstance) {
    agentManagerInstance = new AgentManager(workingDir || process.cwd());
  }
  return agentManagerInstance;
}
