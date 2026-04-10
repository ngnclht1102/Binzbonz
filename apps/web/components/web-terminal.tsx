"use client";
import { useEffect, useRef, useState, useCallback } from "react";

interface WebTerminalProps {
  agentId: string;
  agentName: string;
  projectId: string;
  onClose: () => void;
}

export default function WebTerminal({
  agentId,
  agentName,
  projectId,
  onClose,
}: WebTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<any>(null);
  const cleanupRef = useRef(false);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  // Use callback ref to know exactly when the DOM element is available
  const setupTerminal = useCallback(async (container: HTMLDivElement) => {
    if (cleanupRef.current) return;
    if (termRef.current) return;

    // Load xterm CSS
    if (!document.querySelector('link[data-xterm-css]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/xterm.css";
      link.setAttribute("data-xterm-css", "true");
      document.head.appendChild(link);
    }

    const { Terminal } = await import("@xterm/xterm");
    const { FitAddon } = await import("@xterm/addon-fit");

    if (cleanupRef.current || !container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    // Need a small delay for the container to have dimensions
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    termRef.current = terminal;

    terminal.writeln(`\x1b[36mConnecting to ${agentName}...\x1b[0m`);

    const ws = new WebSocket("ws://localhost:3001/terminal");
    wsRef.current = ws;

    ws.onopen = () => {
      if (cleanupRef.current) { ws.close(); return; }
      setStatus("connected");
      ws.send(JSON.stringify({
        type: "init",
        agentId,
        projectId,
        cols: terminal.cols,
        rows: terminal.rows,
      }));
    };

    ws.onmessage = (event) => {
      if (cleanupRef.current) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output" || msg.type === "exit") {
          terminal.write(msg.data);
        } else if (msg.type === "error") {
          terminal.writeln(`\x1b[31mError: ${msg.data}\x1b[0m`);
        }
        if (msg.type === "exit") {
          setStatus("disconnected");
        }
      } catch {
        terminal.write(event.data);
      }
    };

    ws.onclose = () => {
      if (cleanupRef.current) return;
      setStatus("disconnected");
      terminal.writeln("\r\n\x1b[33mConnection closed.\x1b[0m");
    };

    ws.onerror = () => {
      if (cleanupRef.current) return;
      setStatus("disconnected");
      terminal.writeln("\r\n\x1b[31mWebSocket error.\x1b[0m");
    };

    terminal.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }));
      }
    };
    window.addEventListener("resize", handleResize);

    // Store cleanup function
    const origCleanup = cleanupRef.current;
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [agentId, agentName, projectId]);

  useEffect(() => {
    cleanupRef.current = false;
    if (containerRef.current) {
      setupTerminal(containerRef.current);
    }

    return () => {
      cleanupRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [setupTerminal]);

  // Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: "#0d1117" }}>
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-200">
            Terminal: {agentName}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              status === "connected"
                ? "bg-green-500/20 text-green-400"
                : status === "connecting"
                ? "bg-yellow-500/20 text-yellow-400"
                : "bg-red-500/20 text-red-400"
            }`}
          >
            {status}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-sm px-3 py-1 rounded hover:bg-gray-700 transition-colors"
        >
          Close (Esc)
        </button>
      </div>
      <div
        ref={containerRef}
        style={{ flex: 1, padding: 4, minHeight: 0 }}
      />
    </div>
  );
}
