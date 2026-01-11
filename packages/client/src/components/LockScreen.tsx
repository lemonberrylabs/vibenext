"use client";

import { useState, type FormEvent } from "react";

export interface LockScreenProps {
  onAuthenticated: () => void;
  authenticate: (password: string) => Promise<{ success: boolean; error?: string }>;
}

export function LockScreen({ onAuthenticated, authenticate }: LockScreenProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await authenticate(password);
      if (result.success) {
        onAuthenticated();
      } else {
        setError(result.error || "Authentication failed");
        setPassword("");
      }
    } catch {
      setError("Failed to authenticate");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.icon}>🔒</span>
          <h2 style={styles.title}>Vibe Coder</h2>
        </div>
        
        <p style={styles.subtitle}>Enter your password to continue</p>
        
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            style={styles.input}
            disabled={loading}
            autoFocus
          />
          
          {error && <p style={styles.error}>{error}</p>}
          
          <button 
            type="submit" 
            style={{
              ...styles.button,
              opacity: loading ? 0.7 : 1,
            }}
            disabled={loading || !password}
          >
            {loading ? "Unlocking..." : "Unlock"}
          </button>
        </form>
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
    padding: "24px",
    minHeight: "200px",
  },
  card: {
    width: "100%",
    maxWidth: "280px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
  },
  icon: {
    fontSize: "20px",
  },
  title: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 600,
    color: "#f0f0f0",
  },
  subtitle: {
    margin: "0 0 16px 0",
    fontSize: "13px",
    color: "#888",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  input: {
    padding: "10px 12px",
    fontSize: "14px",
    border: "1px solid #3a3a3a",
    borderRadius: "6px",
    backgroundColor: "#1a1a1a",
    color: "#f0f0f0",
    outline: "none",
    transition: "border-color 0.2s",
  },
  error: {
    margin: 0,
    padding: "8px 12px",
    fontSize: "13px",
    color: "#ff6b6b",
    backgroundColor: "rgba(255, 107, 107, 0.1)",
    borderRadius: "4px",
  },
  button: {
    padding: "10px 16px",
    fontSize: "14px",
    fontWeight: 500,
    color: "#fff",
    backgroundColor: "#6366f1",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "background-color 0.2s",
  },
};
