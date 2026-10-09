import { useEffect, useState } from "react";
import Workspace from "./components/Workspace.jsx";
import "./App.css";

async function getErrorMessage(response) {
  try {
    const body = await response.json();
    return body.error || body.message || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

async function refreshSandbox(sandboxId) {
  const response = await fetch(`/api/sandbox/${encodeURIComponent(sandboxId)}/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await getErrorMessage(response));
  const payload = await response.json();
  return payload.sandbox;
}

async function startSandbox() {
  const response = await fetch("/api/sandbox/start", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(await getErrorMessage(response));
  return response.json();
}

function parseEvent(block) {
  let event = "message";
  const data = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }

  return { event, data: data.join("\n") };
}

function getSandboxStorageKey(user) {
  const identity = user?.email || user?.id;
  return identity ? `draft.activeSandbox.${String(identity).toLowerCase()}` : null;
}

function isValidSandboxId(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function App() {
  const [authStatus, setAuthStatus] = useState("loading");
  const [user, setUser] = useState(null);
  const [sandbox, setSandbox] = useState(null);
  const [activity, setActivity] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStartingSandbox, setIsStartingSandbox] = useState(false);
  const [error, setError] = useState("");
  const [fileRevision, setFileRevision] = useState(0);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        if (!response.ok) {
          if (response.status === 401) {
            if (active) setAuthStatus("ready");
            return;
          }
          throw new Error(await getErrorMessage(response));
        }
        const result = await response.json();
        const currentUser = result?.user || null;
        if (!active) return;
        setUser(currentUser);

        const storageKey = getSandboxStorageKey(currentUser);
        const storedSandboxId = storageKey ? localStorage.getItem(storageKey) : null;
        if (isValidSandboxId(storedSandboxId)) {
          try {
            const restoredSandbox = await refreshSandbox(storedSandboxId);
            if (!active) return;
            if (restoredSandbox) {
              setSandbox(restoredSandbox);
            } else {
              localStorage.removeItem(storageKey);
            }
          } catch (restoreError) {
            if (active) setError(`Could not restore the previous sandbox: ${restoreError.message}`);
          }
        } else if (storageKey && storedSandboxId) {
          localStorage.removeItem(storageKey);
        }

        if (active) setAuthStatus("ready");
      } catch (authError) {
        if (!active) return;
        setError(authError.message);
        setAuthStatus("ready");
      }
    }

    restoreSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!sandbox?.sandboxId) return undefined;

    let active = true;
    let refreshing = false;
    const storageKey = getSandboxStorageKey(user);
    const interval = window.setInterval(async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const restoredSandbox = await refreshSandbox(sandbox.sandboxId);
        if (!active) return;
        if (!restoredSandbox) {
          setSandbox(null);
          if (storageKey) localStorage.removeItem(storageKey);
          setError("This sandbox has expired. Start a new sandbox to continue.");
        }
      } catch (refreshError) {
        if (active) setError(`Could not keep the sandbox active: ${refreshError.message}`);
      } finally {
        refreshing = false;
      }
    }, 2 * 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [sandbox?.sandboxId, user]);

  async function ensureSandbox() {
    let activeSandbox = sandbox;
    if (activeSandbox && !(await refreshSandbox(activeSandbox.sandboxId))) {
      activeSandbox = null;
      setSandbox(null);
      const storageKey = getSandboxStorageKey(user);
      if (storageKey) localStorage.removeItem(storageKey);
    }
    if (!activeSandbox) activeSandbox = await startSandbox();
    setSandbox(activeSandbox);
    const storageKey = getSandboxStorageKey(user);
    if (storageKey) localStorage.setItem(storageKey, activeSandbox.sandboxId);
    return activeSandbox;
  }

  async function createSandbox() {
    if (isStartingSandbox) return;
    setIsStartingSandbox(true);
    setError("");
    try {
      await ensureSandbox();
    } catch (sandboxError) {
      setError(sandboxError.message);
    } finally {
      setIsStartingSandbox(false);
    }
  }

  async function runAgent(message) {
    if (isGenerating) return;
    setIsGenerating(true);
    setError("");
    setActivity([]);

    try {
      const activeSandbox = await ensureSandbox();
      const response = await fetch("/api/ai/agent/invoke", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, projectId: activeSandbox.sandboxId }),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      if (!response.body) throw new Error("The generation stream was not available.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      let completion = null;

      while (!completed) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf("\n\n");

        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const { event: eventName, data } = parseEvent(block);

          if (eventName === "error") {
            let payload;
            try {
              payload = JSON.parse(data);
            } catch {
              payload = { error: data };
            }
            throw new Error(payload.error || "Website generation failed.");
          }
          if (eventName === "done") {
            try {
              completion = JSON.parse(data);
            } catch {
              completion = null;
            }
            completed = true;
            break;
          }
          if (data) {
            let progress = data;
            try {
              const parsed = JSON.parse(data);
              progress = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
            } catch {
              // Keep plain-text progress messages as-is.
            }
            setActivity((items) => [...items, progress]);
          }
          boundary = buffer.indexOf("\n\n");
        }

        if (done) break;
      }

      if (!completed) throw new Error("The generation stream ended before the task completed.");
      setFileRevision((revision) => revision + 1);
      return completion?.response || "";
    } catch (generationError) {
      setError(generationError.message);
      throw generationError;
    } finally {
      setIsGenerating(false);
    }
  }

  async function signOut() {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      setUser(null);
      setSandbox(null);
      setActivity([]);
      const storageKey = getSandboxStorageKey(user);
      if (storageKey) localStorage.removeItem(storageKey);
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }

  if (authStatus === "loading") {
    return <main className="loading-screen"><span className="loader" />Checking your session</main>;
  }

  if (!user) {
    const authFailed = new URLSearchParams(window.location.search).get("auth") === "failed";
    return (
      <main className="signin-page">
        <div className="signin-card">
          <a className="brand" href="/" aria-label="Draft home">
            <span className="brand-mark">d</span>
            <span>draft</span>
          </a>
          <div className="signin-art" aria-hidden="true">
            <div className="art-window">
              <div className="art-toolbar"><i /><i /><i /><span>your-next-idea.site</span></div>
              <div className="art-content">
                <div className="art-nav"><b /><span /><span /><span /></div>
                <div className="art-copy"><i /><b /><b /><span /><span /><button /></div>
                <div className="art-image"><span>✦</span></div>
              </div>
            </div>
            <div className="sparkle sparkle-one">✦</div>
            <div className="sparkle sparkle-two">✧</div>
          </div>
          <p className="eyebrow">YOUR IDEAS, BUILT</p>
          <h1>Make something<br />remarkable.</h1>
          <p className="signin-copy">Describe what you want to create. Your AI workspace turns your words into a live website.</p>
          <a className="google-button" href="/api/auth/google">
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 4)" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.72 7.18l7.64 5.93c4.46-4.12 7.12-10.19 7.12-17.58Z" />
              <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z" transform="translate(0 4)" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.87l-7.64-5.93c-2.12 1.42-4.84 2.27-8.26 2.27-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 -4)" />
            </svg>
            Continue with Google
            <span aria-hidden="true">→</span>
          </a>
          {(authFailed || error) && <p className="form-error">{error || "Google sign-in could not be completed. Please try again."}</p>}
          <p className="signin-terms">By continuing, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.</p>
        </div>
        <div className="signin-footer"><span>Build at the speed of thought.</span><span>Powered by AI <b>✦</b></span></div>
      </main>
    );
  }

  return (
    <Workspace
      user={user}
      sandbox={sandbox}
      isStartingSandbox={isStartingSandbox}
      isGenerating={isGenerating}
      activity={activity}
      error={error}
      fileRevision={fileRevision}
      onCreateSandbox={createSandbox}
      onRefreshFiles={() => setFileRevision((revision) => revision + 1)}
      onRunPrompt={runAgent}
      onSignOut={signOut}
    />
  );
}

export default App;
