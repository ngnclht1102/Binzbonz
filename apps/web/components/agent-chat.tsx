"use client";
import { useEffect, useRef, useState } from "react";
import {
  getSessionMessages,
  sendChatMessage,
  type OpenAIMessage,
} from "@/lib/api";

interface AgentChatProps {
  sessionId: string;
  agentName: string;
  projectName: string;
  /** "modal" = overlay with backdrop. "embedded" = fits its container, no overlay. */
  variant?: "modal" | "embedded";
  /** Called when user closes (modal variant) or not at all (embedded without onClose). */
  onClose?: () => void;
  /** Optional custom content to render in the header left area (e.g. a project picker dropdown). */
  headerLeft?: React.ReactNode;
}

export default function AgentChat({
  sessionId,
  agentName,
  projectName,
  variant = "modal",
  onClose,
  headerLeft,
}: AgentChatProps) {
  const [messages, setMessages] = useState<OpenAIMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSystem, setShowSystem] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(0);

  // Initial fetch + polling every 1s
  useEffect(() => {
    let cancelled = false;
    const fetchMessages = async () => {
      try {
        const data = await getSessionMessages(sessionId);
        if (!cancelled) {
          setMessages(data.messages ?? []);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load messages");
          setLoading(false);
        }
      }
    };
    fetchMessages();
    const interval = setInterval(fetchMessages, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > prevLen.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
    prevLen.current = messages.length;
  }, [messages.length]);

  // Esc to close (only in modal variant)
  useEffect(() => {
    if (variant !== "modal" || !onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [variant, onClose]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      await sendChatMessage(sessionId, input.trim());
      setInput("");
      // Optimistic refresh
      const data = await getSessionMessages(sessionId);
      setMessages(data.messages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    }
    setSending(false);
  };

  // Filter system messages unless toggled
  const visible = showSystem ? messages : messages.filter((m) => m.role !== "system");

  // The inner chat UI — identical between modal and embedded variants.
  const chatBody = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {headerLeft ?? (
            <>
              <span>🌐</span>
              <span className="font-bold truncate">{agentName}</span>
              <span className="text-xs text-gray-500 truncate">— {projectName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowSystem(!showSystem)}
            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded"
            title="Toggle system prompt"
          >
            {showSystem ? "hide" : "show"} system
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-700"
              title={variant === "modal" ? "Close (Esc)" : "Close"}
            >
              {variant === "modal" ? "Close (Esc)" : "×"}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0">
        {loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : visible.length === 0 ? (
          <p className="text-gray-500 text-sm italic">
            No messages yet. Send something below to start the conversation.
          </p>
        ) : (
          visible.map((m, i) => <MessageBubble key={i} message={m} />)
        )}
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-t border-red-800 text-red-300 text-xs shrink-0">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-700 p-3 flex gap-2 shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          rows={2}
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm resize-none focus:outline-none focus:border-blue-500"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium self-end"
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </>
  );

  if (variant === "embedded") {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg h-full flex flex-col overflow-hidden">
        {chatBody}
      </div>
    );
  }

  // Modal variant (default)
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {chatBody}
      </div>
    </div>
  );
}

function fmtTs(ts: string | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  // Show "HH:MM:SS" if today, else "MMM D HH:MM"
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function TimestampLabel({ ts }: { ts: string | undefined }) {
  const formatted = fmtTs(ts);
  if (!formatted) return null;
  return (
    <span className="text-[10px] text-gray-500 ml-2 font-normal" title={ts}>
      {formatted}
    </span>
  );
}

function MessageBubble({ message }: { message: OpenAIMessage }) {
  const [expanded, setExpanded] = useState(false);

  if (message.role === "system") {
    return (
      <div className="bg-gray-800/40 border border-gray-700/50 rounded p-3 text-xs">
        <div className="text-gray-500 font-medium mb-1">
          🤖 system
          <TimestampLabel ts={message._ts} />
        </div>
        <pre className="text-gray-400 whitespace-pre-wrap font-mono text-xs leading-snug">
          {message.content}
        </pre>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="bg-blue-900/20 border border-blue-800/40 rounded p-3 ml-8">
        <div className="text-blue-300 text-xs font-medium mb-1">
          👤 user
          <TimestampLabel ts={message._ts} />
        </div>
        <p className="text-sm text-gray-200 whitespace-pre-wrap">{message.content}</p>
      </div>
    );
  }

  if (message.role === "tool") {
    return (
      <div className="bg-yellow-900/10 border border-yellow-800/30 rounded p-2 mr-8 text-xs">
        <button onClick={() => setExpanded(!expanded)} className="text-yellow-400 font-medium">
          🛠 tool result {expanded ? "▾" : "▸"}{" "}
          <span className="text-gray-500">({message.content?.length ?? 0} chars)</span>
          <TimestampLabel ts={message._ts} />
        </button>
        {expanded && (
          <pre className="text-gray-400 whitespace-pre-wrap font-mono text-xs mt-1 max-h-64 overflow-auto">
            {message.content}
          </pre>
        )}
      </div>
    );
  }

  // Assistant
  const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded p-3 mr-8">
      <div className="text-green-400 text-xs font-medium mb-1">
        🤖 assistant
        <TimestampLabel ts={message._ts} />
      </div>
      {message.content && (
        <p className="text-sm text-gray-200 whitespace-pre-wrap">{message.content}</p>
      )}
      {hasToolCalls && (
        <div className="mt-2 flex flex-col gap-1">
          {message.tool_calls!.map((tc) => (
            <details key={tc.id} className="text-xs">
              <summary className="text-cyan-400 cursor-pointer">
                🛠 {tc.function.name}
                <span className="text-gray-500 ml-1">({tc.function.arguments.length} chars)</span>
              </summary>
              <pre className="text-gray-400 whitespace-pre-wrap font-mono text-xs mt-1 max-h-32 overflow-auto pl-3 border-l border-gray-700">
                {tc.function.arguments}
              </pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
