"use client";

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { checkAuth } from "../actions/auth.js";
import { 
  createThread, 
  getThreadState, 
  sendPrompt,
  checkHealth 
} from "../actions/proxy.js";
import type { ThreadState, ThreadMessage, ContentBlock } from "../types.js";
import { LockScreen } from "./LockScreen.js";

const STORAGE_KEY = "vibe_active_thread_id";
const POLL_INTERVAL_MS = 2000;

type ConnectionStatus = "connected" | "disconnected" | "checking";

export function VibeOverlay() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isConfigured, setIsConfigured] = useState(true);

  // UI state
  const [isMinimized, setIsMinimized] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("checking");

  // Thread state
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [input, setInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check authentication on mount
  useEffect(() => {
    checkAuth().then(({ authenticated, configured }) => {
      setIsAuthenticated(authenticated);
      setIsConfigured(configured);
    });
  }, []);

  // Check control plane health
  const checkConnection = useCallback(async () => {
    const result = await checkHealth();
    setConnectionStatus(result.success ? "connected" : "disconnected");
    return result.success;
  }, []);

  // Poll for thread updates
  const pollThread = useCallback(async (threadId: string) => {
    const result = await getThreadState(threadId);
    if (result.success && result.data) {
      setThread(result.data);
      // Stop polling if not running
      if (result.data.status !== "RUNNING" && pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }, []);

  // Start polling when thread is running
  useEffect(() => {
    if (thread?.status === "RUNNING" && !pollIntervalRef.current) {
      pollIntervalRef.current = setInterval(() => {
        pollThread(thread.id);
      }, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [thread?.status, thread?.id, pollThread]);

  // Load existing thread on mount
  useEffect(() => {
    const loadThread = async () => {
      const isConnected = await checkConnection();
      if (!isConnected) return;

      const storedThreadId = localStorage.getItem(STORAGE_KEY);
      if (storedThreadId) {
        const result = await getThreadState(storedThreadId);
        if (result.success && result.data) {
          setThread(result.data);
        } else {
          // Thread no longer exists, clear storage
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    };

    if (isAuthenticated) {
      loadThread();
    }
  }, [isAuthenticated, checkConnection]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.history]);

  // Create a new thread
  const handleCreateThread = async () => {
    setIsCreating(true);
    const result = await createThread();
    setIsCreating(false);

    if (result.success && result.data) {
      const newThread: ThreadState = {
        id: result.data.threadId,
        branchName: result.data.branchName,
        createdAt: Date.now(),
        status: result.data.status,
        history: [],
        lastCommitHash: null,
      };
      setThread(newThread);
      localStorage.setItem(STORAGE_KEY, newThread.id);
    }
  };

  // Send a message
  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!thread || !input.trim() || thread.status === "RUNNING") return;

    const message = input.trim();
    setInput("");

    // Optimistically add user message
    setThread(prev => prev ? {
      ...prev,
      history: [...prev.history, { role: "user", content: message }],
      status: "RUNNING",
    } : null);

    const result = await sendPrompt(thread.id, message);
    
    if (!result.success) {
      // Revert on error
      setThread(prev => prev ? {
        ...prev,
        history: prev.history.slice(0, -1),
        status: "ERROR",
        errorMessage: result.error,
      } : null);
    }
  };

  // Render message content
  const renderMessageContent = (content: string | ContentBlock[]): string => {
    if (typeof content === "string") return content;
    
    return content
      .filter((block): block is ContentBlock & { type: "text"; text: string } => 
        block.type === "text" && typeof block.text === "string"
      )
      .map(block => block.text)
      .join("\n");
  };

  // Don't render if not configured
  if (!isConfigured) {
    return null;
  }

  // Show loading state
  if (isAuthenticated === null) {
    return null;
  }

  const mainContent = !isAuthenticated ? (
    <LockScreen onAuthenticated={() => setIsAuthenticated(true)} />
  ) : connectionStatus === "disconnected" ? (
    <div style={styles.disconnected}>
      <span style={styles.disconnectedIcon}>⚠️</span>
      <span style={styles.disconnectedText}>
        Disconnected - Control Plane not running
      </span>
      <button 
        onClick={checkConnection} 
        style={styles.retryButton}
      >
        Retry
      </button>
    </div>
  ) : !thread ? (
    <div style={styles.welcome}>
      <h3 style={styles.welcomeTitle}>🎨 Vibe Coder</h3>
      <p style={styles.welcomeText}>
        Start a new coding session. Changes will be made on a separate Git branch.
      </p>
      <button 
        onClick={handleCreateThread}
        disabled={isCreating}
        style={{
          ...styles.createButton,
          opacity: isCreating ? 0.7 : 1,
        }}
      >
        {isCreating ? "Creating..." : "Start New Session"}
      </button>
    </div>
  ) : (
    <>
      {/* Branch indicator */}
      <div style={styles.branchBar}>
        <span style={styles.branchIcon}>🌿</span>
        <code style={styles.branchName}>{thread.branchName}</code>
        {thread.status === "RUNNING" && (
          <span style={styles.statusBadge}>Working...</span>
        )}
        {thread.status === "ERROR" && (
          <span style={styles.errorBadge}>Error</span>
        )}
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {thread.history.map((msg: ThreadMessage, i: number) => (
          <div 
            key={i} 
            style={{
              ...styles.message,
              ...(msg.role === "user" ? styles.userMessage : styles.assistantMessage),
            }}
          >
            <div style={styles.messageRole}>
              {msg.role === "user" ? "You" : "Assistant"}
            </div>
            <div style={styles.messageContent}>
              {renderMessageContent(msg.content)}
            </div>
          </div>
        ))}
        
        {thread.status === "RUNNING" && (
          <div style={styles.thinking}>
            <span style={styles.thinkingDots}>●●●</span>
            <span>Thinking...</span>
          </div>
        )}
        
        {thread.errorMessage && (
          <div style={styles.errorMessage}>
            ⚠️ {thread.errorMessage}
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} style={styles.inputForm}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe what you want to build..."
          style={styles.input}
          disabled={thread.status === "RUNNING"}
        />
        <button 
          type="submit" 
          style={styles.sendButton}
          disabled={!input.trim() || thread.status === "RUNNING"}
        >
          Send
        </button>
      </form>
    </>
  );

  return (
    <div style={styles.container}>
      {/* Main panel */}
      {!isMinimized && (
        <div style={styles.panel}>
          <div style={styles.header}>
            <span style={styles.headerTitle}>🎨 Vibe Coder</span>
            <button 
              onClick={() => setIsMinimized(true)}
              style={styles.minimizeButton}
              aria-label="Minimize"
            >
              −
            </button>
          </div>
          <div style={styles.content}>
            {mainContent}
          </div>
        </div>
      )}

      {/* Floating button when minimized */}
      {isMinimized && (
        <button 
          onClick={() => setIsMinimized(false)}
          style={styles.fab}
          aria-label="Open Vibe Coder"
        >
          🎨
          {connectionStatus === "disconnected" && (
            <span style={styles.fabBadge}>!</span>
          )}
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    zIndex: 9999,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  panel: {
    width: "380px",
    maxWidth: "calc(100vw - 32px)",
    height: "500px",
    maxHeight: "calc(100vh - 100px)",
    backgroundColor: "#1e1e1e",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    border: "1px solid #333",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    backgroundColor: "#252525",
    borderBottom: "1px solid #333",
  },
  headerTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#f0f0f0",
  },
  minimizeButton: {
    width: "24px",
    height: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "4px",
    color: "#888",
    cursor: "pointer",
    fontSize: "18px",
  },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  fab: {
    width: "56px",
    height: "56px",
    borderRadius: "28px",
    backgroundColor: "#6366f1",
    border: "none",
    boxShadow: "0 4px 12px rgba(99, 102, 241, 0.4)",
    cursor: "pointer",
    fontSize: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    transition: "transform 0.2s",
  },
  fabBadge: {
    position: "absolute",
    top: "-4px",
    right: "-4px",
    width: "20px",
    height: "20px",
    borderRadius: "10px",
    backgroundColor: "#ef4444",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  disconnected: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    gap: "12px",
    color: "#f0f0f0",
    textAlign: "center",
  },
  disconnectedIcon: {
    fontSize: "32px",
  },
  disconnectedText: {
    fontSize: "14px",
    color: "#888",
  },
  retryButton: {
    padding: "8px 16px",
    fontSize: "13px",
    backgroundColor: "#333",
    color: "#f0f0f0",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
  welcome: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 24px",
    textAlign: "center",
    flex: 1,
  },
  welcomeTitle: {
    margin: "0 0 8px 0",
    fontSize: "20px",
    color: "#f0f0f0",
  },
  welcomeText: {
    margin: "0 0 24px 0",
    fontSize: "14px",
    color: "#888",
    lineHeight: 1.5,
  },
  createButton: {
    padding: "12px 24px",
    fontSize: "14px",
    fontWeight: 500,
    backgroundColor: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
  },
  branchBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    backgroundColor: "#252525",
    fontSize: "12px",
    borderBottom: "1px solid #333",
  },
  branchIcon: {
    fontSize: "14px",
  },
  branchName: {
    color: "#10b981",
    fontFamily: "monospace",
    flex: 1,
  },
  statusBadge: {
    padding: "2px 8px",
    fontSize: "11px",
    backgroundColor: "#3b82f6",
    color: "#fff",
    borderRadius: "4px",
  },
  errorBadge: {
    padding: "2px 8px",
    fontSize: "11px",
    backgroundColor: "#ef4444",
    color: "#fff",
    borderRadius: "4px",
  },
  messages: {
    flex: 1,
    overflow: "auto",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  message: {
    padding: "10px 12px",
    borderRadius: "8px",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  userMessage: {
    backgroundColor: "#3b3b3b",
    marginLeft: "24px",
    color: "#f0f0f0",
  },
  assistantMessage: {
    backgroundColor: "#2a2a4a",
    marginRight: "24px",
    color: "#e0e0e0",
  },
  messageRole: {
    fontSize: "11px",
    fontWeight: 600,
    marginBottom: "4px",
    color: "#888",
    textTransform: "uppercase",
  },
  messageContent: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  thinking: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    backgroundColor: "#2a2a4a",
    borderRadius: "8px",
    marginRight: "24px",
    color: "#888",
    fontSize: "13px",
  },
  thinkingDots: {
    animation: "pulse 1.5s ease-in-out infinite",
    letterSpacing: "2px",
  },
  errorMessage: {
    padding: "10px 12px",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    borderRadius: "8px",
    color: "#f87171",
    fontSize: "13px",
  },
  inputForm: {
    display: "flex",
    gap: "8px",
    padding: "12px",
    borderTop: "1px solid #333",
    backgroundColor: "#252525",
  },
  input: {
    flex: 1,
    padding: "10px 12px",
    fontSize: "14px",
    backgroundColor: "#1a1a1a",
    border: "1px solid #3a3a3a",
    borderRadius: "6px",
    color: "#f0f0f0",
    outline: "none",
  },
  sendButton: {
    padding: "10px 16px",
    fontSize: "14px",
    fontWeight: 500,
    backgroundColor: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
};
