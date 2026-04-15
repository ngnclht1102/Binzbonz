"use client";
import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * Rolling "live output" pane for an agent while it's working. Renders the
 * actor's live_output tail (server-capped to 128KB), auto-scrolls to the
 * bottom on update, and flashes a green dot if the last update was within
 * the last 5 seconds.
 *
 * The `headerLeft` slot lets callers inject a project picker (or anything
 * else) into the pane header — the global agent page uses it for the
 * project dropdown; the project-scoped page passes nothing and just shows
 * the label.
 */
export function LiveStreamPane({
  agentName,
  output,
  updatedAt,
  headerLeft,
  heightClass = "h-[70vh] lg:h-[calc(100vh-8rem)]",
}: {
  agentName: string;
  output: string | null;
  updatedAt: string | null;
  headerLeft?: ReactNode;
  heightClass?: string;
}) {
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  useEffect(() => {
    const compute = () => {
      if (!updatedAt) {
        setIsLive(false);
        return;
      }
      setIsLive(Date.now() - new Date(updatedAt).getTime() < 5000);
    };
    compute();
    const t = setInterval(compute, 1000);
    return () => clearInterval(t);
  }, [updatedAt]);

  return (
    <div
      className={`bg-gray-950 border border-gray-800 rounded-lg overflow-hidden flex flex-col ${heightClass}`}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900/60">
        {headerLeft ?? (
          <div className="flex items-center gap-2 text-xs text-gray-400 min-w-0">
            <span className="font-semibold text-gray-300 truncate">{agentName}</span>
            <span className="text-gray-600">·</span>
            <span>live output</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${
              isLive ? "bg-green-400 animate-pulse" : "bg-gray-600"
            }`}
          />
          <span className="text-[10px] uppercase tracking-wide text-gray-500">
            {isLive ? "live" : "idle"}
          </span>
        </div>
      </div>
      <pre
        ref={scrollRef}
        className="flex-1 overflow-auto p-4 text-xs font-mono text-gray-300 whitespace-pre-wrap break-words leading-relaxed"
      >
        {output && output.trim().length > 0 ? (
          output
        ) : (
          <span className="text-gray-600 italic">waiting for output…</span>
        )}
      </pre>
    </div>
  );
}

export default LiveStreamPane;
