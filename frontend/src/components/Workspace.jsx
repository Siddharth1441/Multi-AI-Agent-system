import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import "./Workspace.css";

const TerminalPanel = lazy(() => import("./TerminalPanel.jsx"));

async function readResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Request failed (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
  }
  return payload;
}

function createFileTree(files) {
  const root = { name: "", path: "", type: "directory", children: [] };
  for (const file of files) {
    const parts = file.replaceAll("\\", "/").split("/").filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let child = current.children.find((item) => item.name === part);
      if (!child) {
        child = {
          name: part,
          path,
          type: isFile ? "file" : "directory",
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    });
  }

  const sort = (node) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function getAgentApiUrl(sandbox) {
  if (sandbox?.agentApiUrl) return sandbox.agentApiUrl;
  if (!sandbox?.sandboxId) return null;
  return `/api/sandbox/${encodeURIComponent(sandbox.sandboxId)}/agent`;
}

function readWorkspaceState(sandboxId) {
  try {
    const saved = JSON.parse(localStorage.getItem(`draft.workspace.${sandboxId}`) || "null");
    return saved && typeof saved === "object" ? saved : {};
  } catch (error) {
    console.warn("Could not restore saved workspace state:", error);
    return {};
  }
}

function FileNode({ node, selectedFile, onSelect, depth }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="ide-tree-node">
      {node.type === "directory" ? (
        <>
          <button
            className="ide-tree-row ide-tree-directory"
            style={{ "--tree-depth": depth }}
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            <span className={`ide-chevron${expanded ? " is-open" : ""}`}>›</span>
            <span className="ide-folder-icon">{expanded ? "▾" : "▸"}</span>
            <span>{node.name}</span>
          </button>
          {expanded && node.children.map((child) => (
            <FileNode key={child.path} node={child} selectedFile={selectedFile} onSelect={onSelect} depth={depth + 1} />
          ))}
        </>
      ) : (
        <button
          className={`ide-tree-row ide-tree-file${selectedFile === node.path ? " is-selected" : ""}`}
          style={{ "--tree-depth": depth }}
          onClick={() => onSelect(node.path)}
          type="button"
        >
          <span className="ide-file-icon">{node.name.endsWith(".css") ? "◈" : node.name.endsWith(".json") ? "{}" : "◇"}</span>
          <span>{node.name}</span>
        </button>
      )}
    </div>
  );
}

function FileTree({ nodes, selectedFile, onSelect }) {
  return nodes.map((node) => (
    <FileNode key={node.path} node={node} selectedFile={selectedFile} onSelect={onSelect} depth={0} />
  ));
}

export default function Workspace({
  user,
  sandbox,
  isStartingSandbox,
  isGenerating,
  activity,
  error,
  fileRevision,
  onRefreshFiles,
  onCreateSandbox,
  onRunPrompt,
  onSignOut,
}) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [savedFileContent, setSavedFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileError, setFileError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [activeTab, setActiveTab] = useState("preview");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [fileFilter, setFileFilter] = useState("");
  const [hydratedSandboxId, setHydratedSandboxId] = useState("");
  const messageEndRef = useRef(null);
  const lineNumbersRef = useRef(null);
  const hasUnsavedChanges = fileContent !== savedFileContent;
  const agentApiUrl = getAgentApiUrl(sandbox);
  const sandboxId = sandbox?.sandboxId;

  const fileTree = useMemo(() => createFileTree(
    files.filter((file) => file.toLowerCase().includes(fileFilter.toLowerCase())),
  ), [files, fileFilter]);

  useEffect(() => {
    if (!sandbox?.sandboxId) {
      setHydratedSandboxId("");
      setMessages([]);
      setSelectedFile("");
      setActiveTab("preview");
      setFileFilter("");
      return;
    }

    const saved = readWorkspaceState(sandbox.sandboxId);
    setMessages(Array.isArray(saved.messages) ? saved.messages.filter((message) =>
      message && ["user", "assistant"].includes(message.role) && typeof message.content === "string"
    ) : []);
    setSelectedFile(typeof saved.selectedFile === "string" ? saved.selectedFile : "");
    setActiveTab(saved.activeTab === "files" ? "files" : "preview");
    setFileFilter(typeof saved.fileFilter === "string" ? saved.fileFilter : "");
    setHydratedSandboxId(sandbox.sandboxId);
  }, [sandbox?.sandboxId]);

  useEffect(() => {
    if (!sandbox?.sandboxId || hydratedSandboxId !== sandbox.sandboxId) return;
    try {
      localStorage.setItem(`draft.workspace.${sandbox.sandboxId}`, JSON.stringify({
        messages,
        selectedFile,
        activeTab,
        fileFilter,
        editorDraft: hasUnsavedChanges ? { file: selectedFile, content: fileContent } : null,
      }));
    } catch (error) {
      console.warn("Could not save workspace state:", error);
    }
  }, [sandbox?.sandboxId, hydratedSandboxId, messages, selectedFile, activeTab, fileFilter, fileContent, hasUnsavedChanges]);

  useEffect(() => {
    setFiles([]);
    setSelectedFile("");
    setFileContent("");
    setSavedFileContent("");
    setFileError("");
    setSaveError("");
    if (!agentApiUrl) return undefined;

    let active = true;
    fetch(`${agentApiUrl}/list-files`)
      .then(readResponse)
      .then((payload) => {
        if (!Array.isArray(payload.files)) throw new Error("Sandbox returned an invalid file list");
        if (!active) return;
        setFiles(payload.files);
        setSelectedFile((current) => current || payload.files.find((file) => file.endsWith("src/App.jsx")) || "");
      })
      .catch((loadError) => {
        if (active) setFileError(loadError.message);
      });

    return () => {
      active = false;
    };
  }, [sandbox?.sandboxId, agentApiUrl, fileRevision]);

  useEffect(() => {
    if (!agentApiUrl || !selectedFile) {
      setFileContent("");
      return undefined;
    }

    let active = true;
    setFileLoading(true);
    setFileError("");
    const query = new URLSearchParams({ files: selectedFile });
    fetch(`${agentApiUrl}/read-files?${query}`)
      .then(readResponse)
      .then((payload) => {
        if (!Array.isArray(payload.results)) throw new Error("Sandbox returned an invalid file response");
        const result = payload.results.find((item) => Object.keys(item).some((path) => path.replaceAll("\\", "/").endsWith(selectedFile)));
        const content = result && Object.values(result)[0];
        if (typeof content !== "string") throw new Error("The selected file was not returned by the sandbox");
        if (content.startsWith("Error reading file:")) throw new Error(content);
        if (active) {
          const savedWorkspace = readWorkspaceState(sandboxId);
          const draft = savedWorkspace.editorDraft;
          setFileContent(draft?.file === selectedFile && typeof draft.content === "string" ? draft.content : content);
          setSavedFileContent(content);
          setSaveError("");
        }
      })
      .catch((loadError) => {
        if (active) {
          setFileContent("");
          setSavedFileContent("");
          setFileError(loadError.message);
        }
      })
      .finally(() => {
        if (active) setFileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [agentApiUrl, selectedFile, fileRevision, sandboxId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, activity, isGenerating]);

  async function sendPrompt(event) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || isGenerating) return;
    if (hasUnsavedChanges && !window.confirm("Your unsaved edits may be replaced by the AI update. Continue?")) return;
    setPrompt("");
    setMessages((current) => [...current, { role: "user", content: text }]);
    try {
      const response = await onRunPrompt(text);
      setMessages((current) => [...current, {
        role: "assistant",
        content: response || "The request is complete. The preview and file list have been refreshed.",
      }]);
    } catch (runError) {
      setMessages((current) => [...current, { role: "assistant", content: runError.message || "The build could not be completed.", isError: true }]);
    }
  }

  function selectFile(file) {
    if (file === selectedFile) {
      setActiveTab("files");
      return;
    }
    if (hasUnsavedChanges && !window.confirm("Discard your unsaved changes and open another file?")) return;
    setSelectedFile(file);
    setActiveTab("files");
  }

  function refreshFiles() {
    if (hasUnsavedChanges && !window.confirm("Refreshing may discard your unsaved edits. Continue?")) return;
    onRefreshFiles();
  }

  async function saveFile() {
    if (!agentApiUrl || !selectedFile || !hasUnsavedChanges || fileSaving) return;
    setFileSaving(true);
    setSaveError("");
    try {
      const response = await fetch(`${agentApiUrl}/update-file`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: [{ file: selectedFile, content: fileContent }] }),
      });
      const payload = await readResponse(response);
      if (!Array.isArray(payload.results)) throw new Error("Sandbox returned an invalid file-update response");
      const result = payload.results.find((item) =>
        Object.keys(item).some((file) => file.replaceAll("\\", "/").endsWith(selectedFile))
      );
      const resultMessage = result && Object.values(result)[0];
      if (typeof resultMessage !== "string" || resultMessage.toLowerCase().startsWith("error")) {
        throw new Error(typeof resultMessage === "string" ? resultMessage : "The sandbox did not confirm the file update");
      }
      setSavedFileContent(fileContent);
      onRefreshFiles();
    } catch (saveFailure) {
      setSaveError(saveFailure.message);
    } finally {
      setFileSaving(false);
    }
  }

  return (
    <main className="ide-shell">
      <header className="ide-topbar">
        <a className="ide-brand" href="/" aria-label="Draft workspace home"><span className="ide-brand-mark">d</span><span>draft</span></a>
        <div className="ide-project-label"><span className={`ide-project-dot${sandbox ? " is-online" : ""}`} />{sandbox ? "Untitled project" : "No project open"}</div>
        <div className="ide-topbar-actions">
          {sandbox && <span className="ide-sandbox-id">{sandbox.sandboxId.slice(0, 8)}</span>}
          <span className="ide-user-name">{user.name || user.email}</span>
          <span className="ide-avatar">{(user.name || user.email || "U").slice(0, 1).toUpperCase()}</span>
          <button className="ide-signout" onClick={onSignOut} type="button">Sign out</button>
        </div>
      </header>

      <div className="ide-workspace">
        <aside className="ide-sidebar">
          <div className="ide-sidebar-title"><span>EXPLORER</span><button className="ide-icon-button" onClick={refreshFiles} type="button" disabled={!sandbox} aria-label="Refresh files">↻</button></div>
          <div className="ide-project-root"><span>▾</span>{sandbox ? "WORKSPACE" : "NO PROJECT"}</div>
          {sandbox ? (
            <>
              <label className="ide-file-search">
                <span>⌕</span>
                <input aria-label="Filter files" onChange={(event) => setFileFilter(event.target.value)} placeholder="Filter files" value={fileFilter} />
              </label>
              <div className="ide-file-tree">
                {fileError ? <p className="ide-inline-error">{fileError}</p> : fileTree.length ? <FileTree nodes={fileTree} selectedFile={selectedFile} onSelect={selectFile} /> : <p className="ide-empty-note">Loading project files…</p>}
              </div>
            </>
          ) : (
            <div className="ide-sidebar-empty"><span>◫</span><p>Create a sandbox to explore project files.</p></div>
          )}
          <div className="ide-sidebar-bottom"><span className={`ide-connection-dot${sandbox ? " is-online" : ""}`} />{sandbox ? "Sandbox connected" : "Sandbox not started"}</div>
        </aside>

        <section className="ide-main">
          <div className="ide-editor-tabs">
            <button className={`ide-editor-tab${activeTab === "preview" ? " is-active" : ""}`} onClick={() => setActiveTab("preview")} type="button"><span className="ide-tab-icon">◉</span>Preview</button>
            {selectedFile && <button className={`ide-editor-tab${activeTab === "files" ? " is-active" : ""}`} onClick={() => setActiveTab("files")} type="button"><span className="ide-tab-icon ide-code-icon">{selectedFile.endsWith(".css") ? "◈" : "◇"}</span>{selectedFile.split("/").pop()}{hasUnsavedChanges && <span className="ide-unsaved-dot" aria-label="Unsaved changes" />}<span className="ide-tab-close" onClick={(event) => { event.stopPropagation(); if (hasUnsavedChanges && !window.confirm("Discard your unsaved changes and close this file?")) return; setSelectedFile(""); setActiveTab("preview"); }}>×</span></button>}
            <div className="ide-editor-spacer" />
            {activeTab === "files" && selectedFile && <div className="ide-save-actions">{saveError && <span className="ide-save-error" role="alert">{saveError}</span>}<span className="ide-save-status">{fileSaving ? "Saving…" : hasUnsavedChanges ? "Unsaved changes" : "Saved"}</span><button className="ide-save-button" disabled={!hasUnsavedChanges || fileSaving || fileLoading} onClick={saveFile} type="button">{fileSaving ? "Saving…" : "Save"}</button></div>}
            {sandbox && activeTab === "preview" && <a className="ide-open-preview" href={sandbox.previewUrl} rel="noreferrer" target="_blank">Open preview ↗</a>}
          </div>

          <div className="ide-editor-content">
            {activeTab === "preview" ? (
              sandbox ? <iframe className="ide-preview-frame" key={`${sandbox.sandboxId}-${fileRevision}`} src={`${sandbox.previewUrl}${fileRevision ? `?v=${fileRevision}` : ""}`} title="Live website preview" /> :
                <div className="ide-empty-canvas">
                  <div className="ide-empty-icon">✦</div>
                  <h1>Your workspace is ready</h1>
                  <p>Start a sandbox to open your live preview, project files, and terminal.</p>
                  <button className="ide-primary-button" disabled={isStartingSandbox} onClick={onCreateSandbox} type="button">{isStartingSandbox ? <><span className="ide-spinner" />Starting sandbox…</> : "＋  Start a sandbox"}</button>
                </div>
            ) : (
              <div className="ide-file-viewer">
                <div className="ide-viewer-breadcrumb"><span>workspace</span><span>/</span><strong>{selectedFile}</strong></div>
                {fileLoading ? <div className="ide-viewer-message">Loading file…</div> : fileError ? <div className="ide-viewer-message ide-inline-error">{fileError}</div> : (
                  <div className="ide-code-scroll">
                    <div className="ide-line-numbers" ref={lineNumbersRef} aria-hidden="true">{fileContent.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</div>
                    <textarea
                      aria-label={`Edit ${selectedFile}`}
                      className="ide-code-editor"
                      disabled={fileLoading}
                      onChange={(event) => setFileContent(event.target.value)}
                      onScroll={(event) => {
                        if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
                      }}
                      onKeyDown={(event) => {
                        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                          event.preventDefault();
                          saveFile();
                        }
                      }}
                      spellCheck="false"
                      value={fileContent}
                      wrap="off"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {sandbox ? <Suspense fallback={<section className="ide-terminal"><div className="ide-terminal-placeholder-body">Loading terminal…</div></section>}><TerminalPanel key={sandbox.sandboxId} agentUrl={sandbox.agentUrl} /></Suspense> : (
            <section className="ide-terminal ide-terminal-placeholder">
              <header className="ide-terminal-header"><div className="ide-terminal-title"><span className="ide-terminal-icon">›_</span><span>Terminal</span></div><span className="ide-terminal-status">Not connected</span></header>
              <div className="ide-terminal-placeholder-body">Start a sandbox to connect to its terminal.</div>
            </section>
          )}
        </section>

        <aside className="ide-chat">
          <div className="ide-chat-header"><div><span className="ide-chat-spark">✦</span><div><strong>AI assistant</strong><small>{sandbox ? "Ready to build with you" : "Start a sandbox to begin"}</small></div></div><span className="ide-model-badge">GEMINI</span></div>
          <div className="ide-chat-messages">
            {!messages.length && (
              <div className="ide-chat-welcome">
                <span className="ide-welcome-spark">✦</span>
                <h2>What would you like to make?</h2>
                <p>Describe a feature, page, or improvement. I’ll update your project and you can see the result in the preview.</p>
                <div className="ide-suggestions">
                  {["Build a polished landing page", "Add a responsive navigation bar", "Improve the page styling"].map((suggestion) => <button key={suggestion} disabled={!sandbox || isGenerating} onClick={() => setPrompt(suggestion)} type="button">{suggestion}<span>→</span></button>)}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div className={`ide-chat-message ${message.role}${message.isError ? " has-error" : ""}`} key={`${index}-${message.role}`}>
                <span className="ide-message-avatar">{message.role === "user" ? (user.name || user.email || "U").slice(0, 1).toUpperCase() : "✦"}</span>
                <div><small>{message.role === "user" ? "You" : "Draft AI"}</small><p>{message.content}</p></div>
              </div>
            ))}
            {isGenerating && (
              <div className="ide-chat-progress">
                <span className="ide-message-avatar">✦</span>
                <div><small>Draft AI</small><p className="ide-progress-line"><span className="ide-spinner" />{activity.at(-1) || "Working on your project…"}</p></div>
              </div>
            )}
            {error && <div className="ide-chat-error" role="alert">{error}</div>}
            <div ref={messageEndRef} />
          </div>
          <form className="ide-chat-composer" onSubmit={sendPrompt}>
            {!sandbox && <p>Start a sandbox before sending a prompt.</p>}
            <textarea aria-label="Message the AI assistant" disabled={!sandbox || isGenerating} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} placeholder="Ask AI to build or change something…" rows={3} value={prompt} />
            <div className="ide-composer-footer"><span>Enter to send · Shift+Enter for newline</span><button aria-label="Send prompt" disabled={!sandbox || isGenerating || !prompt.trim()} type="submit">{isGenerating ? <span className="ide-spinner" /> : "↑"}</button></div>
          </form>
        </aside>
      </div>
    </main>
  );
}
