"use client";

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import type { ThreadState, ThreadMessage, ContentBlock, VibeActions } from "../types";
import { LockScreen } from "./LockScreen";

export interface VibeOverlayProps {
  /**
   * Server actions that the overlay will use to communicate with the control plane.
   * These must be implemented in your app using "use server" directive.
   */
  actions: VibeActions;
  /**
   * Override the production check. Only use this if you REALLY know what you're doing.
   * Setting this to true in production is a SECURITY RISK.
   * @default false
   */
  dangerouslyAllowProduction?: boolean;
}

const STORAGE_KEY = "vibe_active_thread_id";
const POLL_INTERVAL_MS = 2000;

type ConnectionStatus = "connected" | "disconnected" | "checking";

/**
 * Check if we're in production - this is a safety guard
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function VibeOverlay({ actions, dangerouslyAllowProduction = false }: VibeOverlayProps) {
  // SECURITY: Check if we should be disabled (computed once, stable reference)
  const shouldDisable = isProduction() && !dangerouslyAllowProduction;

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isConfigured, setIsConfigured] = useState(true);

  // UI state
  const [isMinimized, setIsMinimized] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("checking");

  // Thread state
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [allThreads, setAllThreads] = useState<ThreadState[]>([]);
  const [showThreadList, setShowThreadList] = useState(false);
  const [input, setInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check authentication on mount
  useEffect(() => {
    actions.checkAuth().then(({ authenticated, configured }) => {
      setIsAuthenticated(authenticated);
      setIsConfigured(configured);
    });
  }, [actions]);

  // Check control plane health
  const checkConnection = useCallback(async () => {
    const result = await actions.checkHealth();
    setConnectionStatus(result.success ? "connected" : "disconnected");
    return result.success;
  }, [actions]);

  // Load all threads
  const loadAllThreads = useCallback(async () => {
    const result = await actions.listThreads();
    if (result.success && result.data) {
      setAllThreads(result.data);
    }
  }, [actions]);

  // Poll for thread updates
  const pollThread = useCallback(async (threadId: string) => {
    const result = await actions.getThreadState(threadId);
    if (result.success && result.data) {
      setThread(result.data);
      // Stop polling if not running
      if (result.data.status !== "RUNNING" && pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }, [actions]);

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

  // Load existing thread on mount and setup periodic health check
  useEffect(() => {
    if (!isAuthenticated) return;

    const loadThread = async () => {
      const isConnected = await checkConnection();
      if (!isConnected) return;

      // Load all threads
      await loadAllThreads();

      const storedThreadId = localStorage.getItem(STORAGE_KEY);
      if (storedThreadId) {
        const result = await actions.getThreadState(storedThreadId);
        if (result.success && result.data) {
          setThread(result.data);
        } else {
          // Thread no longer exists, clear storage
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    };

    loadThread();

    // Periodic health check every 10 seconds when disconnected
    const healthCheckInterval = setInterval(async () => {
      if (connectionStatus === "disconnected") {
        await checkConnection();
      }
    }, 10000);

    return () => clearInterval(healthCheckInterval);
  }, [isAuthenticated, checkConnection, connectionStatus, loadAllThreads, actions]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.history]);

  // Create a new thread
  const handleCreateThread = async () => {
    setIsCreating(true);
    setMergeError(null);
    const result = await actions.createThread();
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
      // Refresh thread list
      loadAllThreads();
    }
  };

  // Start a new session (clear current thread)
  const handleNewSession = () => {
    localStorage.removeItem(STORAGE_KEY);
    setThread(null);
    setMergeError(null);
  };

  // Merge thread to main
  const handleMerge = async () => {
    if (!thread || thread.status === "RUNNING") return;

    setIsMerging(true);
    setMergeError(null);
    
    const result = await actions.mergeThread(thread.id);
    setIsMerging(false);

    if (result.success && result.data?.success) {
      // Clear thread after successful merge
      localStorage.removeItem(STORAGE_KEY);
      setThread(null);
      // Refresh thread list
      loadAllThreads();
    } else {
      setMergeError(result.error || result.data?.error || "Merge failed");
    }
  };

  // Switch to a different thread
  const handleSwitchThread = async (threadId: string) => {
    if (thread?.id === threadId) {
      setShowThreadList(false);
      return;
    }

    setIsSwitching(true);
    setMergeError(null);
    
    const result = await actions.switchThread(threadId);
    setIsSwitching(false);
    setShowThreadList(false);

    if (result.success && result.data) {
      setThread(result.data);
      localStorage.setItem(STORAGE_KEY, result.data.id);
    } else {
      setMergeError(result.error || "Failed to switch thread");
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

    const result = await actions.sendPrompt(thread.id, message);
    
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
  const renderMessageContent = (content: string | ContentBlock[]): React.ReactNode => {
    if (typeof content === "string") return content;
    
    return content.map((block, i) => {
      if (block.type === "text" && block.text) {
        return <span key={i}>{block.text}</span>;
      }
      if (block.type === "tool_use" && block.name) {
        return (
          <div key={i} style={styles.toolUse}>
            <span style={styles.toolIcon}>🔧</span>
            <code>{block.name}</code>
          </div>
        );
      }
      if (block.type === "tool_result" && block.content) {
        const preview = typeof block.content === "string" 
          ? block.content.slice(0, 100) + (block.content.length > 100 ? "..." : "")
          : "[result]";
        return (
          <div key={i} style={styles.toolResult}>
            <span style={styles.toolIcon}>📋</span>
            <code>{preview}</code>
          </div>
        );
      }
      return null;
    });
  };

  // SECURITY: Block rendering in production unless explicitly overridden
  if (shouldDisable) {
    return null;
  }

  // Don't render if not configured
  if (!isConfigured) {
    // Show a minimal indicator in development
    return (
      <div style={styles.container}>
        <div 
          style={{
            ...styles.fab,
            backgroundColor: "#6b7280",
            cursor: "default",
          }}
          title="VIBE_PASSWORD not configured"
        >
          🔒
        </div>
      </div>
    );
  }

  // Show loading state
  if (isAuthenticated === null) {
    return null;
  }

  const mainContent = !isAuthenticated ? (
    <LockScreen 
      onAuthenticated={() => setIsAuthenticated(true)} 
      authenticate={actions.authenticate}
    />
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
        <button
          onClick={() => setShowThreadList(!showThreadList)}
          style={styles.branchButton}
          title={allThreads.length > 1 ? "Click to switch branches" : "Current branch"}
        >
          <code style={styles.branchName}>{thread.branchName}</code>
          {allThreads.length > 1 && (
            <span style={styles.branchDropdownIcon}>
              {showThreadList ? "▲" : "▼"}
            </span>
          )}
        </button>
        {thread.status === "RUNNING" && (
          <span style={styles.statusBadge}>Working...</span>
        )}
        {thread.status === "ERROR" && (
          <span style={styles.errorBadge}>Error</span>
        )}
        {thread.status === "IDLE" && (
          <>
            <button
              onClick={handleMerge}
              disabled={isMerging}
              style={styles.mergeButton}
              title="Merge changes to main"
            >
              {isMerging ? "Merging..." : "✓ Merge"}
            </button>
            <button
              onClick={handleNewSession}
              style={styles.newSessionButton}
              title="Start a new session"
            >
              +
            </button>
          </>
        )}
      </div>
      
      {/* Thread list dropdown */}
      {showThreadList && allThreads.length > 0 && (
        <div style={styles.threadList}>
          <div style={styles.threadListHeader}>
            <span>Switch Branch</span>
            <span style={styles.threadCount}>{allThreads.length} sessions</span>
          </div>
          {allThreads.map((t) => (
            <button
              key={t.id}
              onClick={() => handleSwitchThread(t.id)}
              disabled={isSwitching}
              style={{
                ...styles.threadItem,
                ...(t.id === thread.id ? styles.threadItemActive : {}),
              }}
            >
              <code style={styles.threadItemBranch}>{t.branchName}</code>
              <span style={styles.threadItemStatus}>
                {t.status === "RUNNING" && "⏳"}
                {t.status === "ERROR" && "⚠️"}
                {t.status === "IDLE" && t.history.length > 0 && `${t.history.length} msgs`}
                {t.status === "IDLE" && t.history.length === 0 && "New"}
              </span>
            </button>
          ))}
        </div>
      )}
      
      {/* Last commit indicator */}
      {thread.lastCommitHash && (
        <div style={styles.commitBar}>
          <span style={styles.commitIcon}>📝</span>
          <code style={styles.commitHash}>
            Last commit: {thread.lastCommitHash.slice(0, 7)}
          </code>
        </div>
      )}
      
      {/* Merge error */}
      {mergeError && (
        <div style={styles.mergeErrorBar}>
          ⚠️ {mergeError}
        </div>
      )}

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
  },
  branchButton: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flex: 1,
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    textAlign: "left",
  },
  branchDropdownIcon: {
    fontSize: "8px",
    color: "#666",
    marginLeft: "4px",
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
  mergeButton: {
    padding: "2px 8px",
    fontSize: "11px",
    backgroundColor: "#10b981",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: 500,
  },
  newSessionButton: {
    width: "20px",
    height: "20px",
    padding: 0,
    fontSize: "14px",
    backgroundColor: "#4b5563",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  commitBar: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 12px",
    backgroundColor: "#1a1a1a",
    fontSize: "11px",
    borderBottom: "1px solid #333",
  },
  commitIcon: {
    fontSize: "12px",
  },
  commitHash: {
    color: "#888",
    fontFamily: "monospace",
  },
  mergeErrorBar: {
    padding: "8px 12px",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
    color: "#f87171",
    fontSize: "12px",
  },
  threadList: {
    backgroundColor: "#1a1a1a",
    borderBottom: "1px solid #333",
    maxHeight: "200px",
    overflow: "auto",
  },
  threadListHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    fontSize: "11px",
    color: "#888",
    borderBottom: "1px solid #2a2a2a",
    textTransform: "uppercase",
    fontWeight: 600,
  },
  threadCount: {
    fontWeight: 400,
    textTransform: "none",
  },
  threadItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "8px 12px",
    backgroundColor: "transparent",
    border: "none",
    borderBottom: "1px solid #2a2a2a",
    cursor: "pointer",
    textAlign: "left",
    color: "#ccc",
  },
  threadItemActive: {
    backgroundColor: "#2a2a4a",
  },
  threadItemBranch: {
    fontFamily: "monospace",
    fontSize: "11px",
    color: "#10b981",
  },
  threadItemStatus: {
    fontSize: "10px",
    color: "#888",
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
  toolUse: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 8px",
    marginTop: "4px",
    backgroundColor: "rgba(99, 102, 241, 0.2)",
    borderRadius: "4px",
    fontSize: "11px",
  },
  toolResult: {
    display: "flex",
    alignItems: "flex-start",
    gap: "6px",
    padding: "4px 8px",
    marginTop: "4px",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderRadius: "4px",
    fontSize: "11px",
    maxHeight: "60px",
    overflow: "hidden",
  },
  toolIcon: {
    fontSize: "12px",
    flexShrink: 0,
  },
};
