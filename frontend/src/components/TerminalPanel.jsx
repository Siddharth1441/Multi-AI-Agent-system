import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { io } from "socket.io-client";
import "@xterm/xterm/css/xterm.css";

export default function TerminalPanel({ agentUrl }) {
  const [connected, setConnected] = useState(false);
  const terminalRef = useRef(null);
  const terminalElementRef = useRef(null);
  const lastConnectionErrorRef = useRef("");

  useEffect(() => {
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      theme: {
        background: "#0b0f16",
        foreground: "#b8c5d5",
        cursor: "#d1ae7e",
        selectionBackground: "#38475b",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalElementRef.current);
    terminalRef.current = terminal;

    const socket = io(agentUrl, {
      transports: ["polling", "websocket"],
      reconnection: true,
      timeout: 10000,
    });
    const fitTerminal = () => {
      if (!terminalElementRef.current?.clientWidth || !terminalElementRef.current?.clientHeight) return;
      fitAddon.fit();
      socket.emit("terminal-resize", { cols: terminal.cols, rows: terminal.rows });
    };

    socket.on("connect", () => {
      setConnected(true);
      lastConnectionErrorRef.current = "";
      fitTerminal();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (error) => {
      setConnected(false);
      if (lastConnectionErrorRef.current !== error.message) {
        terminal.writeln(`\r\nTerminal connection failed: ${error.message}`);
        lastConnectionErrorRef.current = error.message;
      }
    });
    socket.on("terminal-output", (data) => terminal.write(String(data)));
    socket.on("terminal-error", (message) => terminal.writeln(`\r\nTerminal error: ${message}`));

    const resizeObserver = new ResizeObserver(fitTerminal);
    if (terminalElementRef.current) resizeObserver.observe(terminalElementRef.current);
    terminal.onData((data) => {
      if (socket.connected) socket.emit("terminal-input", data);
    });

    return () => {
      resizeObserver.disconnect();
      socket.disconnect();
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [agentUrl]);

  return (
    <section className="ide-terminal" aria-label="Sandbox terminal">
      <header className="ide-terminal-header">
        <div className="ide-terminal-title"><span className="ide-terminal-icon">›_</span><span>Terminal</span></div>
        <span className={`ide-terminal-status${connected ? " is-online" : ""}`}><i />{connected ? "Connected" : "Disconnected"}</span>
        <button className="ide-icon-button ide-terminal-clear" onClick={() => terminalRef.current?.clear()} type="button" aria-label="Clear terminal">⌫</button>
      </header>
      <div className="ide-terminal-screen" ref={terminalElementRef} />
    </section>
  );
}
