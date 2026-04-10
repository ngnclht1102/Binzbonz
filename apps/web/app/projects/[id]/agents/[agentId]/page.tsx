"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  getActor,
  getWakeEvents,
  getAgentProjectSession,
  type Actor,
  type AgentProjectSession,
  type WakeEvent,
} from "@/lib/api";

const WebTerminal = dynamic(() => import("@/components/web-terminal"), { ssr: false });

const STATUS_DOT: Record<string, string> = {
  idle: "bg-gray-400",
  working: "bg-green-400 animate-pulse",
  compacting: "bg-yellow-400",
};

const EVENT_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  processing: "bg-blue-500/20 text-blue-400 animate-pulse",
  done: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
  skipped: "bg-gray-500/20 text-gray-400",
};

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const agentId = params.agentId as string;
  const [agent, setAgent] = useState<Actor | null>(null);
  const [events, setEvents] = useState<WakeEvent[]>([]);
  const [session, setSession] = useState<AgentProjectSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);

  const fetchData = async () => {
    try {
      const [a, e, s] = await Promise.all([
        getActor(agentId),
        getWakeEvents({ agent_id: agentId }),
        getAgentProjectSession(agentId, projectId).catch(() => null),
      ]);
      setAgent(a);
      setEvents(e);
      setSession(s);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [agentId]);

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (!agent) return <div className="p-8 text-red-400">Agent not found</div>;

  const processing = events.filter((e) => e.status === "processing");
  const pending = events.filter((e) => e.status === "pending");
  const history = events.filter((e) => ["done", "failed", "skipped"].includes(e.status));

  return (
    <div className="p-8 max-w-4xl">
      {/* Back link */}
      <button
        onClick={() => router.push(`/projects/${projectId}/agents`)}
        className="text-sm text-gray-400 hover:text-gray-200 mb-4 inline-block"
      >
        ← Back to agents
      </button>

      {/* Agent header */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${STATUS_DOT[agent.status] ?? "bg-gray-400"}`} />
            <h1 className="text-2xl font-bold">{agent.name}</h1>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                agent.role === "ctbaceo"
                  ? "bg-purple-500/20 text-purple-400"
                  : "bg-blue-500/20 text-blue-400"
              }`}
            >
              {agent.role}
            </span>
            <span className="text-sm text-gray-400">{agent.status}</span>
          </div>
          <button
            onClick={() => setShowTerminal(true)}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-medium transition-colors flex items-center gap-2"
          >
            <span>{'>'}_</span> Terminal
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500 text-xs uppercase">Type</p>
            <p>{agent.type}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase">Last Active (this project)</p>
            <p>{session?.last_active_at ? new Date(session.last_active_at).toLocaleString() : "Never"}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase">Session (this project)</p>
            <p className="font-mono text-xs">{session?.session_id ? session.session_id.slice(0, 12) + "..." : "None"}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase">Tokens (this project)</p>
            <p>{session?.last_token_count?.toLocaleString() ?? 0}</p>
          </div>
        </div>
      </div>

      {/* In Progress */}
      {processing.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            In Progress ({processing.length})
          </h2>
          <div className="flex flex-col gap-2">
            {processing.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </div>
      )}

      {/* Queue */}
      {pending.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2">
            Queue ({pending.length})
          </h2>
          <div className="flex flex-col gap-2">
            {pending.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2">
          History ({history.length})
        </h2>
        {history.length === 0 ? (
          <p className="text-gray-500 text-sm">No completed events yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {history.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>

      {/* Terminal overlay */}
      {showTerminal && agent && (
        <WebTerminal
          agentId={agent.id}
          agentName={agent.name}
          projectId={projectId}
          onClose={() => setShowTerminal(false)}
        />
      )}
    </div>
  );
}

function EventCard({ event }: { event: WakeEvent }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className={`text-xs px-2 py-0.5 rounded-full ${EVENT_STATUS_COLORS[event.status] ?? ""}`}>
          {event.status}
        </span>
        <div>
          <p className="text-sm">
            <span className="text-gray-300">{event.triggered_by}</span>
            {event.task_id && (
              <span className="text-gray-500 ml-2 font-mono text-xs">
                task: {event.task_id.slice(0, 8)}
              </span>
            )}
          </p>
          {event.project && (
            <p className="text-xs text-gray-500">{event.project.name}</p>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500">
        {new Date(event.created_at).toLocaleString()}
      </p>
    </div>
  );
}
