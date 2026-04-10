"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  getActor,
  getWakeEvents,
  getAgentProjectSessions,
  getProjects,
  type Actor,
  type AgentProjectSession,
  type Project,
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

export default function GlobalAgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.agentId as string;
  const [agent, setAgent] = useState<Actor | null>(null);
  const [events, setEvents] = useState<WakeEvent[]>([]);
  const [sessions, setSessions] = useState<AgentProjectSession[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalProjectId, setTerminalProjectId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [a, e, s, p] = await Promise.all([
        getActor(agentId),
        getWakeEvents({ agent_id: agentId }),
        getAgentProjectSessions(agentId).catch(() => [] as AgentProjectSession[]),
        getProjects().catch(() => [] as Project[]),
      ]);
      setAgent(a);
      setEvents(e);
      setSessions(s);
      setAllProjects(p);
    } catch { /* ignore */ }
    setLoading(false);
  };

  // Default the terminal target to the most recently active project (or any project if none)
  useEffect(() => {
    if (terminalProjectId) return;
    if (sessions.length > 0) {
      // sessions are already ordered by last_active_at DESC server-side
      setTerminalProjectId(sessions[0].project_id);
    } else if (allProjects.length > 0) {
      setTerminalProjectId(allProjects[0].id);
    }
  }, [sessions, allProjects, terminalProjectId]);

  // Project rows for the Project Sessions table — every project, with session info if available
  const projectRows = useMemo(() => {
    const sessionByProject = new Map(sessions.map((s) => [s.project_id, s]));
    return allProjects
      .map((proj) => ({
        project: proj,
        session: sessionByProject.get(proj.id) ?? null,
      }))
      .sort((a, b) => {
        // Active sessions first (sorted by last_active_at DESC), then no-session projects by name
        const aActive = a.session?.last_active_at ? new Date(a.session.last_active_at).getTime() : 0;
        const bActive = b.session?.last_active_at ? new Date(b.session.last_active_at).getTime() : 0;
        if (aActive !== bActive) return bActive - aActive;
        return a.project.name.localeCompare(b.project.name);
      });
  }, [allProjects, sessions]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [agentId]);

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (!agent) return <div className="p-8 text-red-400">Agent not found</div>;

  const processing = events.filter((e) => e.status === "processing");
  const pending = events.filter((e) => e.status === "pending");
  const history = events
    .filter((e) => ["done", "failed", "skipped"].includes(e.status))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="p-8 max-w-4xl">
      <button
        onClick={() => router.push("/agents")}
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
          {/* Terminal launcher: project picker + open button */}
          <div className="flex items-center gap-2">
            <select
              value={terminalProjectId ?? ""}
              onChange={(e) => setTerminalProjectId(e.target.value || null)}
              className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500 max-w-[200px]"
              title="Pick project for terminal session"
            >
              {projectRows.length === 0 && <option value="">No projects</option>}
              {projectRows.map(({ project, session }) => (
                <option key={project.id} value={project.id}>
                  {project.name} {session?.session_id ? "" : "(new)"}
                </option>
              ))}
            </select>
            <button
              disabled={!terminalProjectId}
              onClick={() => setShowTerminal(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium transition-colors flex items-center gap-2"
            >
              <span>{'>'}_</span> Terminal
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-500 text-xs uppercase">Type</p>
            <p>{agent.type}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase">Created</p>
            <p>{new Date(agent.created_at).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase">Active Project Sessions</p>
            <p>{sessions.filter((s) => s.session_id).length} / {allProjects.length}</p>
          </div>
        </div>
      </div>

      {/* Project Sessions table */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2">
          Project Sessions
        </h2>
        {projectRows.length === 0 ? (
          <p className="text-gray-500 text-sm">No projects yet.</p>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50">
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Session</th>
                  <th className="px-3 py-2 font-medium">Tokens</th>
                  <th className="px-3 py-2 font-medium">Last Active</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {projectRows.map(({ project, session }) => {
                  const hasSession = !!session?.session_id;
                  return (
                    <tr
                      key={project.id}
                      className={`border-t border-gray-800 ${
                        hasSession ? "" : "text-gray-600"
                      }`}
                    >
                      <td className="px-3 py-2">{project.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {session?.session_id ? session.session_id.slice(0, 12) + "..." : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {session?.last_token_count?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {session?.last_active_at
                          ? new Date(session.last_active_at).toLocaleString()
                          : "never"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => {
                            setTerminalProjectId(project.id);
                            setShowTerminal(true);
                          }}
                          className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
                          title="Open terminal in this project"
                        >
                          terminal
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* In Progress */}
      {processing.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            In Progress ({processing.length})
          </h2>
          <div className="flex flex-col gap-2">
            {processing.map((e) => <EventCard key={e.id} event={e} />)}
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
            {pending.map((e) => <EventCard key={e.id} event={e} />)}
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
            {history.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        )}
      </div>

      {/* Terminal */}
      {showTerminal && terminalProjectId && (
        <WebTerminal
          agentId={agent.id}
          agentName={agent.name}
          projectId={terminalProjectId}
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
