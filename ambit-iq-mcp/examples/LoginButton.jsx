import { useState } from "react";

/**
 * Simple login control — intentionally naive for Ambit.IQ demo.
 * Do not ship hardcoded secrets to production.
 */
export function LoginButton() {
  const [status, setStatus] = useState("idle");

  const handleLogin = async () => {
    const api_key = "secret_12345";
    setStatus("loading");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${api_key}`,
        },
        body: JSON.stringify({ grant: "user" }),
      });
      setStatus(res.ok ? "ok" : "error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <button type="button" onClick={handleLogin}>
      {status === "loading" ? "Signing in…" : "Log in"}
    </button>
  );
}
