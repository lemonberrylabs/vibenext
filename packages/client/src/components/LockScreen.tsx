"use client";

import { useState, useEffect, type FormEvent } from "react";

export interface LockScreenProps {
  onAuthenticated: () => void;
  authenticate: (password: string) => Promise<{ success: boolean; error?: string }>;
}

// Inject keyframe animations once
const STYLE_ID = "vibe-lockscreen-styles";
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes vibe-lock-glow {
      0%, 100% {
        box-shadow: 0 0 20px rgba(0, 255, 200, 0.15),
                    0 0 40px rgba(0, 255, 200, 0.05),
                    inset 0 0 20px rgba(0, 255, 200, 0.03);
      }
      50% {
        box-shadow: 0 0 30px rgba(0, 255, 200, 0.25),
                    0 0 60px rgba(0, 255, 200, 0.1),
                    inset 0 0 30px rgba(0, 255, 200, 0.05);
      }
    }

    @keyframes vibe-lock-shimmer {
      0% { background-position: -200% center; }
      100% { background-position: 200% center; }
    }

    @keyframes vibe-lock-pulse {
      0%, 100% { opacity: 0.4; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.1); }
    }

    @keyframes vibe-lock-shake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
      20%, 40%, 60%, 80% { transform: translateX(4px); }
    }

    @keyframes vibe-lock-unlock {
      0% { transform: scale(1) rotate(0deg); opacity: 1; }
      50% { transform: scale(1.2) rotate(-15deg); opacity: 1; }
      100% { transform: scale(0) rotate(45deg); opacity: 0; }
    }

    @keyframes vibe-lock-gradient-shift {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    .vibe-lock-input::placeholder {
      color: rgba(0, 255, 200, 0.3);
      font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
      letter-spacing: 0.15em;
    }

    .vibe-lock-input:focus {
      border-color: rgba(0, 255, 200, 0.5);
      box-shadow: 0 0 0 3px rgba(0, 255, 200, 0.1),
                  0 0 20px rgba(0, 255, 200, 0.15);
    }

    .vibe-lock-button:hover:not(:disabled) {
      background: linear-gradient(135deg, rgba(0, 255, 200, 0.25) 0%, rgba(0, 200, 255, 0.25) 100%);
      border-color: rgba(0, 255, 200, 0.6);
      transform: translateY(-1px);
      box-shadow: 0 4px 20px rgba(0, 255, 200, 0.3);
    }

    .vibe-lock-button:active:not(:disabled) {
      transform: translateY(0);
    }

    .vibe-lock-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);
}

export function LockScreen({ onAuthenticated, authenticate }: LockScreenProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    injectStyles();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await authenticate(password);
      if (result.success) {
        setUnlocking(true);
        setTimeout(() => onAuthenticated(), 400);
      } else {
        setError(result.error || "Access denied");
        setPassword("");
        setShake(true);
        setTimeout(() => setShake(false), 500);
      }
    } catch (err) {
      console.error("[VibeCoder] Authentication error:", err);
      setError("Connection failed");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Ambient background effects */}
      <div style={styles.ambientOrb1} />
      <div style={styles.ambientOrb2} />

      <div
        style={{
          ...styles.card,
          animation: shake
            ? "vibe-lock-shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97)"
            : unlocking
              ? "vibe-lock-unlock 0.4s ease-out forwards"
              : "vibe-lock-glow 3s ease-in-out infinite",
        }}
      >
        {/* Decorative corner accents */}
        <div style={styles.cornerTL} />
        <div style={styles.cornerTR} />
        <div style={styles.cornerBL} />
        <div style={styles.cornerBR} />

        {/* Lock icon with animation */}
        <div
          style={{
            ...styles.iconContainer,
            animation: loading ? "vibe-lock-pulse 1s ease-in-out infinite" : undefined,
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            <circle cx="12" cy="16" r="1" fill="currentColor" />
          </svg>
        </div>

        {/* Title with gradient */}
        <h2 style={styles.title}>
          <span style={styles.titleGradient}>VIBE</span>
          <span style={styles.titleAccent}>CODER</span>
        </h2>

        <p style={styles.subtitle}>
          <span style={styles.subtitleDot} />
          SECURE TERMINAL ACCESS
          <span style={styles.subtitleDot} />
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputWrapper}>
            <div style={styles.inputGlow} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="ENTER PASSKEY"
              className="vibe-lock-input"
              style={styles.input}
              disabled={loading || unlocking}
              autoFocus
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div style={styles.errorContainer}>
              <span style={styles.errorIcon}>!</span>
              <p style={styles.error}>{error}</p>
            </div>
          )}

          <button
            type="submit"
            className="vibe-lock-button"
            style={styles.button}
            disabled={loading || !password || unlocking}
          >
            <span style={styles.buttonContent}>
              {loading ? (
                <>
                  <span style={styles.loadingDot}>●</span>
                  <span style={{ ...styles.loadingDot, animationDelay: "0.2s" }}>●</span>
                  <span style={{ ...styles.loadingDot, animationDelay: "0.4s" }}>●</span>
                </>
              ) : unlocking ? (
                "ACCESS GRANTED"
              ) : (
                <>
                  <span>AUTHENTICATE</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 8 }}>
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </span>
          </button>
        </form>

        {/* Bottom decorative line */}
        <div style={styles.bottomLine} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 24px",
    minHeight: "280px",
    position: "relative",
    overflow: "hidden",
  },
  ambientOrb1: {
    position: "absolute",
    top: "-50%",
    left: "-30%",
    width: "200px",
    height: "200px",
    background: "radial-gradient(circle, rgba(0, 255, 200, 0.08) 0%, transparent 70%)",
    borderRadius: "50%",
    pointerEvents: "none",
  },
  ambientOrb2: {
    position: "absolute",
    bottom: "-40%",
    right: "-20%",
    width: "180px",
    height: "180px",
    background: "radial-gradient(circle, rgba(0, 200, 255, 0.06) 0%, transparent 70%)",
    borderRadius: "50%",
    pointerEvents: "none",
  },
  card: {
    width: "100%",
    maxWidth: "300px",
    padding: "28px 24px",
    position: "relative",
    background: "linear-gradient(145deg, rgba(15, 25, 35, 0.95) 0%, rgba(10, 18, 28, 0.98) 100%)",
    borderRadius: "16px",
    border: "1px solid rgba(0, 255, 200, 0.15)",
  },
  cornerTL: {
    position: "absolute",
    top: "-1px",
    left: "-1px",
    width: "20px",
    height: "20px",
    borderTop: "2px solid rgba(0, 255, 200, 0.6)",
    borderLeft: "2px solid rgba(0, 255, 200, 0.6)",
    borderTopLeftRadius: "16px",
  },
  cornerTR: {
    position: "absolute",
    top: "-1px",
    right: "-1px",
    width: "20px",
    height: "20px",
    borderTop: "2px solid rgba(0, 255, 200, 0.6)",
    borderRight: "2px solid rgba(0, 255, 200, 0.6)",
    borderTopRightRadius: "16px",
  },
  cornerBL: {
    position: "absolute",
    bottom: "-1px",
    left: "-1px",
    width: "20px",
    height: "20px",
    borderBottom: "2px solid rgba(0, 200, 255, 0.4)",
    borderLeft: "2px solid rgba(0, 200, 255, 0.4)",
    borderBottomLeftRadius: "16px",
  },
  cornerBR: {
    position: "absolute",
    bottom: "-1px",
    right: "-1px",
    width: "20px",
    height: "20px",
    borderBottom: "2px solid rgba(0, 200, 255, 0.4)",
    borderRight: "2px solid rgba(0, 200, 255, 0.4)",
    borderBottomRightRadius: "16px",
  },
  iconContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "56px",
    height: "56px",
    margin: "0 auto 16px",
    background: "linear-gradient(135deg, rgba(0, 255, 200, 0.1) 0%, rgba(0, 200, 255, 0.05) 100%)",
    borderRadius: "14px",
    border: "1px solid rgba(0, 255, 200, 0.2)",
    color: "rgba(0, 255, 200, 0.9)",
  },
  title: {
    margin: "0 0 8px 0",
    textAlign: "center",
    fontSize: "22px",
    fontWeight: 700,
    letterSpacing: "0.2em",
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
  },
  titleGradient: {
    background: "linear-gradient(135deg, #00ffc8 0%, #00c8ff 50%, #00ffc8 100%)",
    backgroundSize: "200% auto",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    animation: "vibe-lock-gradient-shift 3s ease infinite",
  },
  titleAccent: {
    color: "rgba(255, 255, 255, 0.5)",
    marginLeft: "4px",
  },
  subtitle: {
    margin: "0 0 24px 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    fontSize: "10px",
    fontWeight: 500,
    color: "rgba(0, 255, 200, 0.4)",
    letterSpacing: "0.25em",
    textAlign: "center",
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
  },
  subtitleDot: {
    width: "4px",
    height: "4px",
    borderRadius: "50%",
    backgroundColor: "rgba(0, 255, 200, 0.4)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  inputWrapper: {
    position: "relative",
  },
  inputGlow: {
    position: "absolute",
    inset: "-2px",
    borderRadius: "10px",
    background: "linear-gradient(135deg, rgba(0, 255, 200, 0.2) 0%, transparent 50%, rgba(0, 200, 255, 0.2) 100%)",
    opacity: 0,
    transition: "opacity 0.3s ease",
    pointerEvents: "none",
  },
  input: {
    width: "100%",
    padding: "14px 16px",
    fontSize: "13px",
    fontWeight: 500,
    letterSpacing: "0.15em",
    border: "1px solid rgba(0, 255, 200, 0.2)",
    borderRadius: "8px",
    backgroundColor: "rgba(0, 20, 30, 0.6)",
    color: "rgba(0, 255, 200, 0.9)",
    outline: "none",
    transition: "all 0.3s ease",
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
    boxSizing: "border-box",
  },
  errorContainer: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    backgroundColor: "rgba(255, 80, 80, 0.08)",
    border: "1px solid rgba(255, 80, 80, 0.2)",
    borderRadius: "8px",
  },
  errorIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    fontSize: "12px",
    fontWeight: 700,
    color: "#ff6060",
    backgroundColor: "rgba(255, 80, 80, 0.15)",
    borderRadius: "50%",
    flexShrink: 0,
  },
  error: {
    margin: 0,
    fontSize: "12px",
    fontWeight: 500,
    color: "#ff8080",
    letterSpacing: "0.05em",
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
  },
  button: {
    padding: "14px 20px",
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.15em",
    color: "rgba(0, 255, 200, 0.9)",
    backgroundColor: "rgba(0, 255, 200, 0.1)",
    border: "1px solid rgba(0, 255, 200, 0.3)",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "all 0.25s ease",
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
  },
  buttonContent: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
  },
  loadingDot: {
    display: "inline-block",
    animation: "vibe-lock-pulse 1s ease-in-out infinite",
    fontSize: "10px",
  },
  bottomLine: {
    position: "absolute",
    bottom: "8px",
    left: "50%",
    transform: "translateX(-50%)",
    width: "40px",
    height: "3px",
    background: "linear-gradient(90deg, transparent, rgba(0, 255, 200, 0.3), transparent)",
    borderRadius: "2px",
  },
};
