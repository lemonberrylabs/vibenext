import { query } from "@anthropic-ai/claude-agent-sdk";
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
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  /**
   * Process a user message and run the agent loop
   * Uses Claude Agent SDK to handle tool calls automatically
   */
  async processMessage(
    thread: Thread,
    userMessage: string,
    onUpdate: (thread: Thread) => void
  ): Promise<void> {
    console.log(`[AgentManager] Processing message for thread ${thread.id}: "${userMessage.slice(0, 50)}..."`);

    // Add user message to history
    thread.history.push({
      role: "user",
      content: userMessage,
    });
    onUpdate(thread);

    try {
      console.log(`[AgentManager] Calling Claude Agent SDK...`);

      let assistantResponse = "";
      let hasStartedResponse = false;

      // Use the Agent SDK's query function with streaming
      for await (const message of query({
        prompt: userMessage,
        options: {
          systemPrompt: SYSTEM_PROMPT,
          allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
          cwd: this.workingDir,
          permissionMode: "acceptEdits",
          includePartialMessages: true,
        },
      })) {
        // Handle streaming text deltas
        if (message.type === "stream_event") {
          const event = message.event;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            const textDelta = event.delta.text;
            assistantResponse += textDelta;

            // Add or update assistant message in history for streaming
            if (!hasStartedResponse) {
              thread.history.push({
                role: "assistant",
                content: assistantResponse,
              });
              hasStartedResponse = true;
            } else {
              // Update the last message (which is the assistant's streaming response)
              const lastMessage = thread.history[thread.history.length - 1];
              if (lastMessage) {
                lastMessage.content = assistantResponse;
              }
            }
            onUpdate(thread);
          }
        }
      }

      console.log(`[AgentManager] Claude Agent SDK response complete`);

      // Ensure we have the final response in history
      if (assistantResponse && !hasStartedResponse) {
        thread.history.push({
          role: "assistant",
          content: assistantResponse,
        });
        onUpdate(thread);
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
}

// Singleton instance
let agentManagerInstance: AgentManager | null = null;

export function getAgentManager(workingDir?: string): AgentManager {
  if (!agentManagerInstance) {
    agentManagerInstance = new AgentManager(workingDir || process.cwd());
  }
  return agentManagerInstance;
}
