"use client";

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import type { ThreadState, ThreadMessage, ContentBlock, VibeActions } from "../types.js";
import { LockScreen } from "./LockScreen.js";

export interface VibeOverlayProps {
  actions: VibeActions;
  dangerouslyAllowProduction?: boolean;
}

const STORAGE_KEY = "vibe_active_thread_id";
const POLL_INTERVAL_MS = 2000;

type ConnectionStatus = "connected" | "disconnected" | "checking";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// Inject keyframe animations once
const STYLE_ID = "vibe-overlay-styles";
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes vibe-panel-slide-in {
      from {
        opacity: 0;
        transform: translateY(20px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes vibe-fab-pulse {
      0%, 100% {
        box-shadow: 0 0 20px rgba(0, 255, 200, 0.3),
                    0 4px 20px rgba(0, 0, 0, 0.3);
      }
      50% {
        box-shadow: 0 0 35px rgba(0, 255, 200, 0.5),
                    0 4px 30px rgba(0, 0, 0, 0.4);
      }
    }

    @keyframes vibe-thinking-pulse {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 1; }
    }

    @keyframes vibe-glow-border {
      0%, 100% {
        border-color: rgba(0, 255, 200, 0.15);
      }
      50% {
        border-color: rgba(0, 255, 200, 0.3);
      }
    }

    @keyframes vibe-message-appear {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes vibe-status-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    @keyframes vibe-scanner-line {
      0% { top: 0; opacity: 1; }
      50% { opacity: 0.5; }
      100% { top: 100%; opacity: 0; }
    }

    .vibe-input::placeholder {
      color: rgba(0, 255, 200, 0.25);
      font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
    }

    .vibe-input:focus {
      border-color: rgba(0, 255, 200, 0.4);
      box-shadow: 0 0 0 2px rgba(0, 255, 200, 0.08),
                  inset 0 0 20px rgba(0, 255, 200, 0.03);
    }

    .vibe-button:hover:not(:disabled) {
      background: linear-gradient(135deg, rgba(0, 255, 200, 0.3) 0%, rgba(0, 200, 255, 0.2) 100%);
      border-color: rgba(0, 255, 200, 0.5);
      transform: translateY(-1px);
      box-shadow: 0 4px 16px rgba(0, 255, 200, 0.25);
    }

    .vibe-button:active:not(:disabled) {
      transform: translateY(0);
    }

    .vibe-fab:hover {
      transform: scale(1.05);
      box-shadow: 0 0 40px rgba(0, 255, 200, 0.5),
                  0 6px 30px rgba(0, 0, 0, 0.4);
    }

    .vibe-thread-item:hover {
      background: rgba(0, 255, 200, 0.08);
    }

    .vibe-action-btn:hover:not(:disabled) {
      background: rgba(0, 255, 200, 0.2);
      border-color: rgba(0, 255, 200, 0.4);
    }

    .vibe-scrollbar::-webkit-scrollbar {
      width: 6px;
    }

    .vibe-scrollbar::-webkit-scrollbar-track {
      background: rgba(0, 255, 200, 0.03);
      border-radius: 3px;
    }

    .vibe-scrollbar::-webkit-scrollbar-thumb {
      background: rgba(0, 255, 200, 0.15);
      border-radius: 3px;
    }

    .vibe-scrollbar::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 255, 200, 0.25);
    }
  `;
  document.head.appendChild(style);
}

export function VibeOverlay({ actions, dangerouslyAllowProduction = false }: VibeOverlayProps) {
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
  const [error, setError] = useState<string | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    injectStyles();
  }, []);

  useEffect(() => {
    actions.checkAuth().then(({ authenticated, configured }) => {
      setIsAuthenticated(authenticated);
      setIsConfigured(configured);
    });
  }, [actions]);

  const checkConnection = useCallback(async () => {
    const result = await actions.checkHealth();
    setConnectionStatus(result.success ? "connected" : "disconnected");
    return result.success;
  }, [actions]);

  const loadAllThreads = useCallback(async () => {
    const result = await actions.listThreads();
    if (result.success && result.data) {
      setAllThreads(result.data);
    }
  }, [actions]);

  const pollThread = useCallback(async (threadId: string) => {
    const result = await actions.getThreadState(threadId);
    if (result.success && result.data) {
      setThread(result.data);
      if (!result.data.operation) {
        loadAllThreads();
      }
    } else if (!result.success && result.error?.includes("not found")) {
      localStorage.removeItem(STORAGE_KEY);
      setThread(null);
      loadAllThreads();
    }
  }, [actions, loadAllThreads]);

  useEffect(() => {
    const shouldPoll = thread?.status === "RUNNING" || thread?.operation;

    if (shouldPoll && !pollIntervalRef.current) {
      pollIntervalRef.current = setInterval(() => {
        pollThread(thread.id);
      }, POLL_INTERVAL_MS);
    }

    if (!shouldPoll && pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [thread?.status, thread?.operation, thread?.id, pollThread]);

  const loadCurrentBranch = useCallback(async () => {
    const result = await actions.getCurrentBranch();
    if (result.success && result.data) {
      setCurrentBranch(result.data.branch);
    }
  }, [actions]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const loadThread = async () => {
      const isConnected = await checkConnection();
      if (!isConnected) return;

      await loadAllThreads();
      await loadCurrentBranch();

      const storedThreadId = localStorage.getItem(STORAGE_KEY);
      if (storedThreadId) {
        const result = await actions.getThreadState(storedThreadId);
        if (result.success && result.data) {
          setThread(result.data);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    };

    loadThread();

    const healthCheckInterval = setInterval(async () => {
      if (connectionStatus === "disconnected") {
        await checkConnection();
      }
    }, 10000);

    return () => clearInterval(healthCheckInterval);
  }, [isAuthenticated, checkConnection, connectionStatus, loadAllThreads, loadCurrentBranch, actions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.history]);

  const handleCreateThread = async (baseBranch?: string) => {
    setError(null);
    const result = await actions.createThread(baseBranch);

    if (result.success && result.data) {
      const newThread: ThreadState = {
        id: result.data.threadId,
        branchName: result.data.branchName,
        createdAt: Date.now(),
        status: result.data.status,
        history: [],
        lastCommitHash: null,
        operation: "creating",
      };
      setThread(newThread);
      localStorage.setItem(STORAGE_KEY, newThread.id);
      loadAllThreads();
    } else {
      setError(result.error || "Failed to create thread");
    }
  };

  const handleAdoptThread = async (branchName: string) => {
    setError(null);
    const result = await actions.adoptThread(branchName);

    if (result.success && result.data) {
      const newThread: ThreadState = {
        id: result.data.threadId,
        branchName: result.data.branchName,
        createdAt: Date.now(),
        status: result.data.status,
        history: [],
        lastCommitHash: null,
        operation: null, // Ready immediately
      };
      setThread(newThread);
      localStorage.setItem(STORAGE_KEY, newThread.id);
      loadAllThreads();
    } else {
      setError(result.error || "Failed to adopt thread");
    }
  };

  const handleNewSession = () => {
    localStorage.removeItem(STORAGE_KEY);
    setThread(null);
    setError(null);
  };

  const handlePush = async () => {
    if (!thread || thread.status === "RUNNING" || thread.operation) return;

    setError(null);
    const result = await actions.pushThread(thread.id);

    if (result.success && result.data?.success) {
      setThread(prev => prev ? { ...prev, operation: "pushing" } : null);
    } else {
      setError(result.error || result.data?.error || "Push failed");
    }
  };

  const handleMerge = async () => {
    if (!thread || thread.status === "RUNNING" || thread.operation) return;

    setError(null);
    const result = await actions.mergeThread(thread.id);

    if (result.success && result.data?.success) {
      setThread(prev => prev ? { ...prev, operation: "merging" } : null);
    } else {
      setError(result.error || result.data?.error || "Merge failed");
    }
  };

  const handleSwitchThread = async (targetThreadId: string) => {
    if (thread?.id === targetThreadId) {
      setShowThreadList(false);
      return;
    }
    if (thread?.operation) return;

    setError(null);
    setShowThreadList(false);

    const result = await actions.switchThread(targetThreadId);

    if (result.success && result.data?.success) {
      localStorage.setItem(STORAGE_KEY, targetThreadId);
      const targetThread = await actions.getThreadState(targetThreadId);
      if (targetThread.success && targetThread.data) {
        setThread(targetThread.data);
      }
    } else {
      setError(result.error || result.data?.error || "Failed to switch thread");
    }
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!thread || !input.trim() || thread.status === "RUNNING" || thread.operation) return;

    const message = input.trim();
    setInput("");

    setThread(prev => prev ? {
      ...prev,
      history: [...prev.history, { role: "user", content: message }],
      status: "RUNNING",
    } : null);

    const result = await actions.sendPrompt(thread.id, message);

    if (!result.success) {
      setThread(prev => prev ? {
        ...prev,
        history: prev.history.slice(0, -1),
        status: "ERROR",
        errorMessage: result.error,
      } : null);
    }
  };

  const renderMessageContent = (content: string | ContentBlock[]): React.ReactNode => {
    if (typeof content === "string") return content;

    return content.map((block, i) => {
      if (block.type === "text" && block.text) {
        return <span key={i}>{block.text}</span>;
      }
      if (block.type === "tool_use" && block.name) {
        return (
          <div key={i} style={styles.toolUse}>
            <span style={styles.toolIcon}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            </span>
            <code style={styles.toolName}>{block.name}</code>
          </div>
        );
      }
      if (block.type === "tool_result" && block.content) {
        const preview = typeof block.content === "string"
          ? block.content.slice(0, 80) + (block.content.length > 80 ? "..." : "")
          : "[result]";
        return (
          <div key={i} style={styles.toolResult}>
            <span style={styles.resultIcon}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <code style={styles.resultText}>{preview}</code>
          </div>
        );
      }
      return null;
    });
  };

  if (shouldDisable) {
    return null;
  }

  if (!isConfigured) {
    return (
      <div style={styles.container}>
        <div
          style={styles.fabDisabled}
          title="VIBE_PASSWORD not configured"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
      </div>
    );
  }

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
      <div style={styles.disconnectedIconWrapper}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
        </svg>
      </div>
      <span style={styles.disconnectedTitle}>CONNECTION LOST</span>
      <span style={styles.disconnectedText}>
        Control plane is not responding
      </span>
      <button
        onClick={checkConnection}
        className="vibe-button"
        style={styles.retryButton}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        RETRY CONNECTION
      </button>
    </div>
  ) : !thread ? (
    <div style={styles.welcome}>
      {/* Scanner effect */}
      <div style={styles.scannerContainer}>
        <div style={styles.scannerLine} />
      </div>

      <div style={styles.welcomeIcon}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      </div>

      <h3 style={styles.welcomeTitle}>
        <span style={styles.titleHighlight}>VIBE</span>CODER
      </h3>
      <p style={styles.welcomeText}>
        Start an AI-assisted coding session.
        <br />
        Changes isolated on a separate branch.
      </p>
      <div style={styles.createButtonGroup}>
        {/* Show "Continue here" if on a vibe branch */}
        {currentBranch?.startsWith("feat/vibe-") && (
          <button
            onClick={() => handleAdoptThread(currentBranch)}
            className="vibe-button"
            style={styles.createButton}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            CONTINUE HERE
          </button>
        )}
        <button
          onClick={() => handleCreateThread("main")}
          className="vibe-button"
          style={currentBranch?.startsWith("feat/vibe-") ? styles.createButtonSecondary : styles.createButton}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          START FROM MAIN
        </button>
        <button
          onClick={() => handleCreateThread()}
          className="vibe-button"
          style={styles.createButtonSecondary}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          BRANCH FROM CURRENT
        </button>
      </div>

      {allThreads.length > 0 && (
        <div style={styles.existingSessions}>
          <span style={styles.existingLabel}>
            <span style={styles.existingDot} />
            {allThreads.length} EXISTING SESSION{allThreads.length > 1 ? "S" : ""}
          </span>
          <button
            onClick={() => setShowThreadList(!showThreadList)}
            style={styles.showSessionsButton}
          >
            {showThreadList ? "HIDE" : "SHOW"}
          </button>
        </div>
      )}

      {showThreadList && allThreads.length > 0 && (
        <div style={styles.welcomeThreadList}>
          {allThreads.map((t) => (
            <button
              key={t.id}
              onClick={() => handleSwitchThread(t.id)}
              className="vibe-thread-item"
              style={styles.welcomeThreadItem}
            >
              <code style={styles.threadItemBranch}>{t.branchName}</code>
              <span style={styles.threadItemMeta}>
                {t.history.length} msg{t.history.length !== 1 ? "s" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  ) : (
    <>
      {/* Branch header */}
      <div style={styles.branchBar}>
        <div style={styles.branchInfo}>
          <span style={styles.branchIcon}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </span>
          <button
            onClick={() => setShowThreadList(!showThreadList)}
            style={styles.branchButton}
            title={allThreads.length > 1 ? "Switch sessions" : "Current session"}
          >
            <code style={styles.branchName}>{thread.branchName}</code>
            {allThreads.length > 1 && (
              <span style={styles.branchDropdownIcon}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {showThreadList ? (
                    <polyline points="18 15 12 9 6 15" />
                  ) : (
                    <polyline points="6 9 12 15 18 9" />
                  )}
                </svg>
              </span>
            )}
          </button>
        </div>

        <div style={styles.branchActions}>
          {(thread.operation || thread.status === "RUNNING") && (
            <span style={styles.statusBadge}>
              <span style={styles.statusDot} />
              {thread.operation === "creating" && "BRANCHING"}
              {thread.operation === "pushing" && "PUSHING"}
              {thread.operation === "merging" && "MERGING"}
              {thread.operation === "switching" && "SWITCHING"}
              {!thread.operation && thread.status === "RUNNING" && "THINKING"}
            </span>
          )}
          {thread.status === "ERROR" && !thread.operation && (
            <span style={styles.errorBadge}>ERROR</span>
          )}
          {thread.status === "IDLE" && !thread.operation && (
            <>
              <button
                onClick={handlePush}
                className="vibe-action-btn"
                style={styles.actionButton}
                title="Push to remote"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
              <button
                onClick={handleMerge}
                className="vibe-action-btn"
                style={styles.mergeButton}
                title="Merge to main"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ marginLeft: 4 }}>MERGE</span>
              </button>
              <button
                onClick={handleNewSession}
                className="vibe-action-btn"
                style={styles.actionButton}
                title="New session"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Thread list dropdown */}
      {showThreadList && allThreads.length > 0 && (
        <div style={styles.threadList}>
          <div style={styles.threadListHeader}>
            <span>SESSIONS</span>
            <span style={styles.threadCount}>{allThreads.length}</span>
          </div>
          {allThreads.map((t) => (
            <button
              key={t.id}
              onClick={() => handleSwitchThread(t.id)}
              disabled={!!thread?.operation}
              className="vibe-thread-item"
              style={{
                ...styles.threadItem,
                ...(t.id === thread.id ? styles.threadItemActive : {}),
              }}
            >
              <div style={styles.threadItemLeft}>
                {t.id === thread.id && <span style={styles.activeIndicator} />}
                <code style={styles.threadItemBranch}>{t.branchName}</code>
              </div>
              <span style={styles.threadItemStatus}>
                {t.operation && <span style={styles.threadItemSpinner}>●</span>}
                {!t.operation && t.status === "RUNNING" && <span style={styles.threadItemSpinner}>●</span>}
                {!t.operation && t.status === "ERROR" && "ERR"}
                {!t.operation && t.status === "IDLE" && `${t.history.length} msg`}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Last commit indicator */}
      {thread.lastCommitHash && (
        <div style={styles.commitBar}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <line x1="1.05" y1="12" x2="7" y2="12" />
            <line x1="17.01" y1="12" x2="22.96" y2="12" />
          </svg>
          <code style={styles.commitHash}>
            {thread.lastCommitHash.slice(0, 7)}
          </code>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={styles.errorBar}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Messages */}
      <div className="vibe-scrollbar" style={styles.messages}>
        {thread.history.length === 0 && !thread.operation && thread.status !== "RUNNING" && (
          <div style={styles.emptyState}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span style={styles.emptyText}>Describe what you want to build</span>
          </div>
        )}

        {thread.history.map((msg: ThreadMessage, i: number) => (
          <div
            key={i}
            style={{
              ...styles.message,
              ...(msg.role === "user" ? styles.userMessage : styles.assistantMessage),
              animation: "vibe-message-appear 0.3s ease-out",
            }}
          >
            <div style={styles.messageHeader}>
              <span style={{
                ...styles.messageRole,
                ...(msg.role === "user" ? styles.userRole : styles.assistantRole),
              }}>
                {msg.role === "user" ? "YOU" : "AI"}
              </span>
            </div>
            <div style={styles.messageContent}>
              {renderMessageContent(msg.content)}
            </div>
          </div>
        ))}

        {thread.status === "RUNNING" && (
          <div style={styles.thinking}>
            <div style={styles.thinkingDots}>
              <span style={{ ...styles.thinkingDot, animationDelay: "0s" }}>●</span>
              <span style={{ ...styles.thinkingDot, animationDelay: "0.2s" }}>●</span>
              <span style={{ ...styles.thinkingDot, animationDelay: "0.4s" }}>●</span>
            </div>
            <span style={styles.thinkingText}>Processing...</span>
          </div>
        )}

        {thread.errorMessage && (
          <div style={styles.errorMessage}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{thread.errorMessage}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} style={styles.inputForm}>
        <div style={styles.inputWrapper}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What do you want to build?"
            className="vibe-input"
            style={styles.input}
            disabled={thread.status === "RUNNING" || !!thread.operation}
          />
        </div>
        <button
          type="submit"
          className="vibe-button"
          style={styles.sendButton}
          disabled={!input.trim() || thread.status === "RUNNING" || !!thread.operation}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </>
  );

  return (
    <div style={styles.container}>
      {/* Main panel */}
      {!isMinimized && (
        <div style={styles.panel}>
          {/* Corner decorations */}
          <div style={styles.cornerTL} />
          <div style={styles.cornerTR} />
          <div style={styles.cornerBL} />
          <div style={styles.cornerBR} />

          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <span style={styles.headerIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </span>
              <span style={styles.headerTitle}>
                <span style={styles.titleHighlight}>VIBE</span>CODER
              </span>
            </div>
            <div style={styles.headerRight}>
              {connectionStatus === "connected" && (
                <span style={styles.connectedIndicator} title="Connected" />
              )}
              <button
                onClick={() => setIsMinimized(true)}
                style={styles.minimizeButton}
                aria-label="Minimize"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
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
          className="vibe-fab"
          style={styles.fab}
          aria-label="Open Vibe Coder"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
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
    bottom: "20px",
    right: "20px",
    zIndex: 9999,
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', -apple-system, BlinkMacSystemFont, monospace",
  },
  panel: {
    width: "400px",
    maxWidth: "calc(100vw - 40px)",
    height: "560px",
    maxHeight: "calc(100vh - 120px)",
    background: "linear-gradient(165deg, rgba(8, 15, 25, 0.98) 0%, rgba(5, 10, 18, 0.99) 100%)",
    borderRadius: "16px",
    boxShadow: "0 0 40px rgba(0, 255, 200, 0.1), 0 20px 60px rgba(0, 0, 0, 0.5), inset 0 0 80px rgba(0, 255, 200, 0.02)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    border: "1px solid rgba(0, 255, 200, 0.12)",
    animation: "vibe-panel-slide-in 0.3s ease-out, vibe-glow-border 4s ease-in-out infinite",
    position: "relative",
  },
  cornerTL: {
    position: "absolute",
    top: "-1px",
    left: "-1px",
    width: "24px",
    height: "24px",
    borderTop: "2px solid rgba(0, 255, 200, 0.5)",
    borderLeft: "2px solid rgba(0, 255, 200, 0.5)",
    borderTopLeftRadius: "16px",
    pointerEvents: "none",
  },
  cornerTR: {
    position: "absolute",
    top: "-1px",
    right: "-1px",
    width: "24px",
    height: "24px",
    borderTop: "2px solid rgba(0, 255, 200, 0.5)",
    borderRight: "2px solid rgba(0, 255, 200, 0.5)",
    borderTopRightRadius: "16px",
    pointerEvents: "none",
  },
  cornerBL: {
    position: "absolute",
    bottom: "-1px",
    left: "-1px",
    width: "24px",
    height: "24px",
    borderBottom: "2px solid rgba(0, 200, 255, 0.3)",
    borderLeft: "2px solid rgba(0, 200, 255, 0.3)",
    borderBottomLeftRadius: "16px",
    pointerEvents: "none",
  },
  cornerBR: {
    position: "absolute",
    bottom: "-1px",
    right: "-1px",
    width: "24px",
    height: "24px",
    borderBottom: "2px solid rgba(0, 200, 255, 0.3)",
    borderRight: "2px solid rgba(0, 200, 255, 0.3)",
    borderBottomRightRadius: "16px",
    pointerEvents: "none",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 18px",
    background: "linear-gradient(180deg, rgba(0, 255, 200, 0.04) 0%, transparent 100%)",
    borderBottom: "1px solid rgba(0, 255, 200, 0.08)",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  headerIcon: {
    color: "rgba(0, 255, 200, 0.8)",
    display: "flex",
  },
  headerTitle: {
    fontSize: "13px",
    fontWeight: 600,
    color: "rgba(255, 255, 255, 0.6)",
    letterSpacing: "0.1em",
  },
  titleHighlight: {
    color: "rgba(0, 255, 200, 0.9)",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  connectedIndicator: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "rgba(0, 255, 200, 0.8)",
    boxShadow: "0 0 8px rgba(0, 255, 200, 0.5)",
  },
  minimizeButton: {
    width: "28px",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 255, 200, 0.05)",
    border: "1px solid rgba(0, 255, 200, 0.15)",
    borderRadius: "8px",
    color: "rgba(0, 255, 200, 0.6)",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  fab: {
    width: "60px",
    height: "60px",
    borderRadius: "16px",
    background: "linear-gradient(145deg, rgba(0, 255, 200, 0.15) 0%, rgba(0, 200, 255, 0.1) 100%)",
    border: "1px solid rgba(0, 255, 200, 0.3)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    transition: "all 0.3s ease",
    color: "rgba(0, 255, 200, 0.9)",
    animation: "vibe-fab-pulse 3s ease-in-out infinite",
  },
  fabDisabled: {
    width: "60px",
    height: "60px",
    borderRadius: "16px",
    background: "rgba(100, 100, 100, 0.2)",
    border: "1px solid rgba(100, 100, 100, 0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(150, 150, 150, 0.6)",
    cursor: "not-allowed",
  },
  fabBadge: {
    position: "absolute",
    top: "-4px",
    right: "-4px",
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    backgroundColor: "#ff5050",
    color: "#fff",
    fontSize: "11px",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 0 10px rgba(255, 80, 80, 0.5)",
  },
  disconnected: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 24px",
    gap: "16px",
    textAlign: "center",
  },
  disconnectedIconWrapper: {
    color: "rgba(255, 150, 100, 0.7)",
    marginBottom: "8px",
  },
  disconnectedTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "rgba(255, 150, 100, 0.9)",
    letterSpacing: "0.15em",
  },
  disconnectedText: {
    fontSize: "12px",
    color: "rgba(255, 255, 255, 0.4)",
    letterSpacing: "0.05em",
  },
  retryButton: {
    marginTop: "8px",
    padding: "12px 20px",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    backgroundColor: "rgba(0, 255, 200, 0.08)",
    color: "rgba(0, 255, 200, 0.9)",
    border: "1px solid rgba(0, 255, 200, 0.25)",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    display: "flex",
    alignItems: "center",
  },
  welcome: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 28px",
    textAlign: "center",
    flex: 1,
    position: "relative",
  },
  scannerContainer: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none",
    opacity: 0.3,
  },
  scannerLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "2px",
    background: "linear-gradient(90deg, transparent, rgba(0, 255, 200, 0.5), transparent)",
    animation: "vibe-scanner-line 3s ease-in-out infinite",
  },
  welcomeIcon: {
    color: "rgba(0, 255, 200, 0.6)",
    marginBottom: "20px",
  },
  welcomeTitle: {
    margin: "0 0 12px 0",
    fontSize: "22px",
    fontWeight: 700,
    color: "rgba(255, 255, 255, 0.6)",
    letterSpacing: "0.15em",
  },
  welcomeText: {
    margin: "0 0 28px 0",
    fontSize: "12px",
    color: "rgba(255, 255, 255, 0.35)",
    lineHeight: 1.7,
    letterSpacing: "0.03em",
  },
  createButtonGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    width: "100%",
    maxWidth: "280px",
  },
  createButton: {
    padding: "14px 24px",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    backgroundColor: "rgba(0, 255, 200, 0.12)",
    color: "rgba(0, 255, 200, 0.95)",
    border: "1px solid rgba(0, 255, 200, 0.35)",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "all 0.25s ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  createButtonSecondary: {
    padding: "12px 24px",
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    color: "rgba(255, 255, 255, 0.6)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "all 0.25s ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  existingSessions: {
    marginTop: "24px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  existingLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "10px",
    color: "rgba(255, 255, 255, 0.3)",
    letterSpacing: "0.1em",
  },
  existingDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: "rgba(0, 255, 200, 0.4)",
  },
  showSessionsButton: {
    padding: "4px 10px",
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    backgroundColor: "transparent",
    color: "rgba(0, 255, 200, 0.6)",
    border: "1px solid rgba(0, 255, 200, 0.2)",
    borderRadius: "4px",
    cursor: "pointer",
  },
  welcomeThreadList: {
    marginTop: "16px",
    width: "100%",
    maxHeight: "120px",
    overflow: "auto",
    borderRadius: "8px",
    border: "1px solid rgba(0, 255, 200, 0.1)",
  },
  welcomeThreadItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "10px 14px",
    backgroundColor: "transparent",
    border: "none",
    borderBottom: "1px solid rgba(0, 255, 200, 0.05)",
    cursor: "pointer",
    textAlign: "left",
    transition: "background 0.2s ease",
  },
  branchBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    background: "linear-gradient(180deg, rgba(0, 255, 200, 0.03) 0%, transparent 100%)",
    borderBottom: "1px solid rgba(0, 255, 200, 0.06)",
  },
  branchInfo: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  branchIcon: {
    color: "rgba(0, 255, 200, 0.6)",
    display: "flex",
  },
  branchButton: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
  },
  branchName: {
    color: "rgba(0, 255, 200, 0.85)",
    fontSize: "11px",
    letterSpacing: "0.03em",
  },
  branchDropdownIcon: {
    color: "rgba(0, 255, 200, 0.4)",
    display: "flex",
  },
  branchActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  statusBadge: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    fontSize: "9px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    backgroundColor: "rgba(0, 180, 255, 0.12)",
    color: "rgba(0, 200, 255, 0.9)",
    borderRadius: "4px",
    animation: "vibe-status-blink 1.5s ease-in-out infinite",
  },
  statusDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: "currentColor",
  },
  errorBadge: {
    padding: "4px 10px",
    fontSize: "9px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    backgroundColor: "rgba(255, 80, 80, 0.15)",
    color: "#ff8080",
    borderRadius: "4px",
  },
  actionButton: {
    width: "28px",
    height: "24px",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 255, 200, 0.08)",
    color: "rgba(0, 255, 200, 0.7)",
    border: "1px solid rgba(0, 255, 200, 0.15)",
    borderRadius: "5px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  mergeButton: {
    height: "24px",
    padding: "0 10px",
    display: "flex",
    alignItems: "center",
    fontSize: "9px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    backgroundColor: "rgba(0, 255, 200, 0.12)",
    color: "rgba(0, 255, 200, 0.9)",
    border: "1px solid rgba(0, 255, 200, 0.25)",
    borderRadius: "5px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  commitBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 14px",
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    borderBottom: "1px solid rgba(0, 255, 200, 0.04)",
    color: "rgba(0, 255, 200, 0.4)",
  },
  commitHash: {
    fontSize: "10px",
    letterSpacing: "0.05em",
  },
  errorBar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    backgroundColor: "rgba(255, 80, 80, 0.06)",
    borderBottom: "1px solid rgba(255, 80, 80, 0.1)",
    color: "#ff8080",
    fontSize: "11px",
    letterSpacing: "0.03em",
  },
  threadList: {
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderBottom: "1px solid rgba(0, 255, 200, 0.06)",
    maxHeight: "180px",
    overflow: "auto",
  },
  threadListHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    fontSize: "9px",
    fontWeight: 600,
    color: "rgba(0, 255, 200, 0.4)",
    borderBottom: "1px solid rgba(0, 255, 200, 0.05)",
    letterSpacing: "0.15em",
  },
  threadCount: {
    padding: "2px 8px",
    backgroundColor: "rgba(0, 255, 200, 0.1)",
    borderRadius: "10px",
    fontSize: "10px",
    color: "rgba(0, 255, 200, 0.7)",
  },
  threadItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "10px 14px",
    backgroundColor: "transparent",
    border: "none",
    borderBottom: "1px solid rgba(0, 255, 200, 0.03)",
    cursor: "pointer",
    textAlign: "left",
    transition: "background 0.2s ease",
  },
  threadItemActive: {
    backgroundColor: "rgba(0, 255, 200, 0.06)",
  },
  threadItemLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  activeIndicator: {
    width: "4px",
    height: "4px",
    borderRadius: "50%",
    backgroundColor: "rgba(0, 255, 200, 0.9)",
    boxShadow: "0 0 6px rgba(0, 255, 200, 0.5)",
  },
  threadItemBranch: {
    fontSize: "11px",
    color: "rgba(0, 255, 200, 0.7)",
    letterSpacing: "0.02em",
  },
  threadItemStatus: {
    fontSize: "9px",
    color: "rgba(255, 255, 255, 0.3)",
    letterSpacing: "0.05em",
  },
  threadItemMeta: {
    fontSize: "9px",
    color: "rgba(255, 255, 255, 0.3)",
    letterSpacing: "0.05em",
  },
  threadItemSpinner: {
    animation: "vibe-thinking-pulse 1s ease-in-out infinite",
  },
  messages: {
    flex: 1,
    overflow: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    height: "100%",
    color: "rgba(0, 255, 200, 0.15)",
  },
  emptyText: {
    fontSize: "11px",
    color: "rgba(255, 255, 255, 0.25)",
    letterSpacing: "0.05em",
  },
  message: {
    padding: "14px 16px",
    borderRadius: "12px",
    fontSize: "12px",
    lineHeight: 1.6,
    letterSpacing: "0.02em",
  },
  userMessage: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    marginLeft: "28px",
    color: "rgba(255, 255, 255, 0.85)",
    border: "1px solid rgba(255, 255, 255, 0.06)",
  },
  assistantMessage: {
    backgroundColor: "rgba(0, 255, 200, 0.04)",
    marginRight: "28px",
    color: "rgba(255, 255, 255, 0.8)",
    border: "1px solid rgba(0, 255, 200, 0.08)",
  },
  messageHeader: {
    marginBottom: "8px",
  },
  messageRole: {
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.15em",
    padding: "3px 8px",
    borderRadius: "4px",
  },
  userRole: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    color: "rgba(255, 255, 255, 0.5)",
  },
  assistantRole: {
    backgroundColor: "rgba(0, 255, 200, 0.1)",
    color: "rgba(0, 255, 200, 0.7)",
  },
  messageContent: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  thinking: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "14px 16px",
    backgroundColor: "rgba(0, 255, 200, 0.04)",
    borderRadius: "12px",
    marginRight: "28px",
    border: "1px solid rgba(0, 255, 200, 0.08)",
  },
  thinkingDots: {
    display: "flex",
    gap: "4px",
    color: "rgba(0, 255, 200, 0.7)",
    fontSize: "14px",
  },
  thinkingDot: {
    animation: "vibe-thinking-pulse 1s ease-in-out infinite",
  },
  thinkingText: {
    fontSize: "11px",
    color: "rgba(0, 255, 200, 0.5)",
    letterSpacing: "0.05em",
  },
  errorMessage: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px 16px",
    backgroundColor: "rgba(255, 80, 80, 0.06)",
    border: "1px solid rgba(255, 80, 80, 0.15)",
    borderRadius: "10px",
    color: "#ff8080",
    fontSize: "11px",
    letterSpacing: "0.03em",
  },
  inputForm: {
    display: "flex",
    gap: "10px",
    padding: "14px 16px",
    borderTop: "1px solid rgba(0, 255, 200, 0.06)",
    background: "linear-gradient(0deg, rgba(0, 255, 200, 0.02) 0%, transparent 100%)",
  },
  inputWrapper: {
    flex: 1,
    position: "relative",
  },
  input: {
    width: "100%",
    padding: "12px 16px",
    fontSize: "12px",
    backgroundColor: "rgba(0, 20, 30, 0.5)",
    border: "1px solid rgba(0, 255, 200, 0.15)",
    borderRadius: "10px",
    color: "rgba(255, 255, 255, 0.9)",
    outline: "none",
    transition: "all 0.2s ease",
    boxSizing: "border-box",
    letterSpacing: "0.02em",
  },
  sendButton: {
    width: "44px",
    height: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    backgroundColor: "rgba(0, 255, 200, 0.12)",
    color: "rgba(0, 255, 200, 0.9)",
    border: "1px solid rgba(0, 255, 200, 0.25)",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  toolUse: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "5px 10px",
    marginTop: "8px",
    backgroundColor: "rgba(0, 200, 255, 0.08)",
    border: "1px solid rgba(0, 200, 255, 0.15)",
    borderRadius: "6px",
  },
  toolIcon: {
    color: "rgba(0, 200, 255, 0.7)",
    display: "flex",
  },
  toolName: {
    fontSize: "10px",
    color: "rgba(0, 200, 255, 0.9)",
    letterSpacing: "0.03em",
  },
  toolResult: {
    display: "inline-flex",
    alignItems: "flex-start",
    gap: "6px",
    padding: "5px 10px",
    marginTop: "6px",
    backgroundColor: "rgba(0, 255, 200, 0.05)",
    border: "1px solid rgba(0, 255, 200, 0.1)",
    borderRadius: "6px",
    maxWidth: "100%",
    overflow: "hidden",
  },
  resultIcon: {
    color: "rgba(0, 255, 200, 0.6)",
    display: "flex",
    marginTop: "2px",
    flexShrink: 0,
  },
  resultText: {
    fontSize: "10px",
    color: "rgba(0, 255, 200, 0.6)",
    letterSpacing: "0.02em",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
};
