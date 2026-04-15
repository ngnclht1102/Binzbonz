"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  getActor,
  getActors,
  getWakeEvents,
  getAgentProjectSessions,
  getProjects,
  setActorHeartbeat,
  updateProviderConfig,
  ensureAgentProjectSession,
  resetAgentProjectSession,
  deleteActor,
  isOpenAIRole,
  usesChatSlideUI,
  type Actor,
  type AgentProjectSession,
  type Project,
  type WakeEvent,
} from "@/lib/api";

const WebTerminal = dynamic(() => import("@/components/web-terminal"), { ssr: false });
const AgentChat = dynamic(() => import("@/components/agent-chat"), { ssr: false });
import { LiveStreamPane } from "@/components/live-stream-pane";

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
  const [allAgents, setAllAgents] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalProjectId, setTerminalProjectId] = useState<string | null>(null);
  // Chat modal — legacy fallback. For OpenAI agents the main chat now lives
  // in the always-visible side slide. The modal path is kept so other
  // entry points (per-row chat buttons, event card clicks) still work if
  // we ever re-enable them, but for now it's unused on this page.
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatProjectName, setChatProjectName] = useState<string>("");

  // Slide chat (OpenAI agents only) — the inline right-side chat panel.
  // Tracks which project's conversation is currently shown, and the
  // corresponding session row id. Defaults to the most recently active.
  const [slideProjectId, setSlideProjectId] = useState<string | null>(null);
  const [slideSessionId, setSlideSessionId] = useState<string | null>(null);

  // Confirmation state for destructive actions
  const [showDeleteAgent, setShowDeleteAgent] = useState(false);
  const [resettingSessionId, setResettingSessionId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [a, e, s, p, aa] = await Promise.all([
        getActor(agentId),
        getWakeEvents({ agent_id: agentId }),
        getAgentProjectSessions(agentId).catch(() => [] as AgentProjectSession[]),
        getProjects().catch(() => [] as Project[]),
        getActors({ type: "agent" }).catch(() => [] as Actor[]),
      ]);
      setAgent(a);
      setEvents(e);
      setSessions(s);
      setAllProjects(p);
      setAllAgents(aa);
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

  // When the agent transitions into "working", auto-select the project it's
  // actually working on (from the processing wake events) in the terminal
  // project picker — that picker is re-used as the stream-pane project
  // picker while streaming, so this makes the dropdown reflect reality.
  useEffect(() => {
    const current = events.find((e) => e.status === "processing" && e.project_id);
    if (current && current.project_id !== terminalProjectId) {
      setTerminalProjectId(current.project_id);
    }
  }, [events, terminalProjectId]);

  // Default the slide chat target (OpenAI only) to the most recently
  // active project, or any project if none.
  useEffect(() => {
    if (slideProjectId) return;
    if (sessions.length > 0) {
      setSlideProjectId(sessions[0].project_id);
    } else if (allProjects.length > 0) {
      setSlideProjectId(allProjects[0].id);
    }
  }, [sessions, allProjects, slideProjectId]);

  // Whenever slideProjectId changes (or the agent changes), ensure the
  // session row exists and update slideSessionId. This lets the embedded
  // chat always have a valid session id even for "new" projects the bot
  // has never been woken on.
  useEffect(() => {
    if (!agent || !usesChatSlideUI(agent.role) || !slideProjectId) return;
    let cancelled = false;
    ensureAgentProjectSession(agent.id, slideProjectId)
      .then((row) => {
        if (!cancelled) setSlideSessionId(row.id);
      })
      .catch(() => {
        if (!cancelled) setSlideSessionId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [agent, slideProjectId]);

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

  // Click handler for any wake event row.
  //   - openapicoor: switch the inline slide chat to the event's project.
  //   - everyone else (claude, master, openapidev): open the terminal.
  const handleEventClick = async (event: WakeEvent) => {
    if (!event.project_id) return;
    if (usesChatSlideUI(agent.role)) {
      setSlideProjectId(event.project_id);
    } else {
      setTerminalProjectId(event.project_id);
      setShowTerminal(true);
    }
  };

  const showsChatSlide = usesChatSlideUI(agent.role);
  const slideProjectName =
    allProjects.find((p) => p.id === slideProjectId)?.name ?? "";

  // Show the live-stream pane for agents that are actively working and
  // don't already use the chat-slide pattern. openapicoor keeps its chat
  // slide; claude devs, master, AND openapidev get the stream pane.
  const showLiveStream = !showsChatSlide && agent.status === "working";

  // Project picker dropdown rendered into the chat header when in slide mode.
  const slideHeaderLeft = showsChatSlide ? (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className="shrink-0">🌐</span>
      <span className="font-bold shrink-0 truncate">{agent.name}</span>
      <span className="text-xs text-gray-500 shrink-0">—</span>
      <select
        value={slideProjectId ?? ""}
        onChange={(e) => setSlideProjectId(e.target.value || null)}
        className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs focus:outline-none focus:border-blue-500 flex-1 min-w-0 max-w-[200px]"
        title="Switch project"
      >
        {projectRows.length === 0 && <option value="">No projects</option>}
        {projectRows.map(({ project, session }) => (
          <option key={project.id} value={project.id}>
            {project.name}
            {session?.message_count ? ` (${session.message_count})` : ""}
          </option>
        ))}
      </select>
    </div>
  ) : undefined;

  const twoColLayout = showsChatSlide || showLiveStream;

  // Project dropdown rendered into the live-stream pane header — same list
  // the terminal launcher uses, but here the selection just tracks which
  // project the agent is currently streaming from. Auto-synced above when
  // a processing event shows up.
  const streamHeaderLeft = showLiveStream ? (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className="font-semibold text-gray-300 truncate">{agent.name}</span>
      <span className="text-xs text-gray-500 shrink-0">—</span>
      <select
        value={terminalProjectId ?? ""}
        onChange={(e) => setTerminalProjectId(e.target.value || null)}
        className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs focus:outline-none focus:border-blue-500 flex-1 min-w-0 max-w-[200px]"
        title="Switch project"
      >
        {projectRows.length === 0 && <option value="">No projects</option>}
        {projectRows.map(({ project, session }) => (
          <option key={project.id} value={project.id}>
            {project.name} {session?.session_id ? "" : "(new)"}
          </option>
        ))}
      </select>
    </div>
  ) : undefined;

  // If the user switched the dropdown to a project that isn't the one the
  // agent is currently working on, show a placeholder instead of the live
  // buffer — live_output is per-actor, so it always belongs to whichever
  // project is actively processing right now.
  const currentProcessingProjectId =
    events.find((e) => e.status === "processing")?.project_id ?? null;
  const streamMatchesSelection =
    !terminalProjectId ||
    !currentProcessingProjectId ||
    terminalProjectId === currentProcessingProjectId;
  const streamOutput = streamMatchesSelection
    ? agent.live_output ?? null
    : `(${agent.name} isn't working on this project right now — pick "${
        allProjects.find((p) => p.id === currentProcessingProjectId)?.name ??
        "the active project"
      }" to see the live stream.)`;

  return (
    <div className={twoColLayout ? "p-6 flex gap-6 h-screen" : "p-8 max-w-4xl"}>
      {/* LEFT column (or only column for idle Claude agents) */}
      <div className={twoColLayout ? "flex-1 min-w-0 overflow-y-auto pr-2" : ""}>
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
            <span title={isOpenAIRole(agent.role) ? `OpenAI: ${agent.provider_model ?? ""}` : "Claude CLI"}>
              {isOpenAIRole(agent.role) ? "🌐" : "🤖"}
            </span>
            <h1 className="text-2xl font-bold">{agent.name}</h1>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                agent.role === "master"
                  ? "bg-purple-500/20 text-purple-400"
                  : agent.role === "openapidev"
                  ? "bg-cyan-500/20 text-cyan-400"
                  : agent.role === "openapicoor"
                  ? "bg-pink-500/20 text-pink-400"
                  : "bg-blue-500/20 text-blue-400"
              }`}
            >
              {agent.role}
            </span>
            <span className="text-sm text-gray-400">{agent.status}</span>
            {agent.heartbeat_enabled && (
              <span className="text-xs text-yellow-400" title={`Heartbeat every ${agent.heartbeat_interval_seconds}s`}>
                ⏱ heartbeat
              </span>
            )}
            <button
              onClick={() => setShowDeleteAgent(true)}
              className="ml-auto text-xs px-2 py-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
              title="Delete agent"
            >
              Delete
            </button>
          </div>
          {/* Launcher: terminal for Claude only. OpenAI agents use the
              always-visible chat slide on the right side of the page, so
              no launcher is needed here. Hidden entirely while the agent
              is working — the live stream pane on the right takes over,
              and spawning a second claude here would collide with the
              headless one the runner already has running. */}
          {!showsChatSlide && !showLiveStream && (
            <div className="flex items-center gap-2">
              <select
                value={terminalProjectId ?? ""}
                onChange={(e) => setTerminalProjectId(e.target.value || null)}
                className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500 max-w-[200px]"
                title="Pick project"
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
          )}
          {!showsChatSlide && showLiveStream && (
            <span className="text-xs text-gray-500 italic">
              streaming on the right →
            </span>
          )}
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

      {/* OpenAI-only: Provider config + Heartbeat cards */}
      {isOpenAIRole(agent.role) && (
        <>
          <ProviderConfigCard agent={agent} onSaved={fetchData} />
          <HeartbeatCard agent={agent} allAgents={allAgents} onSaved={fetchData} />
        </>
      )}

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
                        <div className="flex items-center justify-end gap-1">
                          {usesChatSlideUI(agent.role) ? (
                            <button
                              onClick={() => setSlideProjectId(project.id)}
                              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                                slideProjectId === project.id
                                  ? "bg-blue-900/40 text-blue-300"
                                  : "bg-gray-800 hover:bg-gray-700"
                              }`}
                              title="Show this project's conversation in the side panel"
                            >
                              💬 {slideProjectId === project.id ? "showing" : "show"}
                            </button>
                          ) : (
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
                          )}
                          {/* Reset button — only when there's a session to reset */}
                          {session && (session.session_id || (session.message_count ?? 0) > 0) && (
                            <button
                              onClick={async () => {
                                if (resettingSessionId) return;
                                if (!confirm(`Reset ${agent.name}'s session for "${project.name}"? This clears the session id and chat history. The next spawn will start fresh.`)) return;
                                setResettingSessionId(session.id);
                                try {
                                  await resetAgentProjectSession(session.id);
                                  await fetchData();
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : 'Failed to reset');
                                }
                                setResettingSessionId(null);
                              }}
                              disabled={resettingSessionId === session.id}
                              className="text-xs px-2 py-0.5 rounded bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-300 transition-colors disabled:opacity-50"
                              title="Reset this (agent, project) session — drops session_id and chat history, keeps the row"
                            >
                              {resettingSessionId === session.id ? '...' : '↻ reset'}
                            </button>
                          )}
                        </div>
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
            {processing.map((e) => (
              <EventCard key={e.id} event={e} onClick={() => handleEventClick(e)} />
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
              <EventCard key={e.id} event={e} onClick={() => handleEventClick(e)} />
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
            {history.map((e) => (
              <EventCard key={e.id} event={e} onClick={() => handleEventClick(e)} />
            ))}
          </div>
        )}
      </div>
      </div>
      {/* /LEFT column */}

      {/* RIGHT column — embedded chat (openapicoor only) */}
      {showsChatSlide && (
        <div className="w-[480px] shrink-0 h-full">
          {slideSessionId ? (
            <AgentChat
              key={slideSessionId}
              sessionId={slideSessionId}
              agentName={agent.name}
              projectName={slideProjectName}
              variant="embedded"
              headerLeft={slideHeaderLeft}
            />
          ) : (
            <div className="h-full bg-gray-900 border border-gray-700 rounded-lg flex items-center justify-center text-gray-500 text-sm">
              {slideProjectId ? "Loading conversation..." : "No projects"}
            </div>
          )}
        </div>
      )}

      {/* RIGHT column — live stream pane (Claude agents while working) */}
      {showLiveStream && (
        <div className="w-[480px] shrink-0 h-full">
          <LiveStreamPane
            agentName={agent.name}
            output={streamOutput}
            updatedAt={agent.live_output_updated_at ?? null}
            headerLeft={streamHeaderLeft}
            heightClass="h-full"
          />
        </div>
      )}

      {/* Terminal (Claude agents only) */}
      {showTerminal && terminalProjectId && (
        <WebTerminal
          agentId={agent.id}
          agentName={agent.name}
          projectId={terminalProjectId}
          onClose={() => setShowTerminal(false)}
        />
      )}

      {/* Chat modal (fallback — still available if some code path opens it) */}
      {chatSessionId && (
        <AgentChat
          sessionId={chatSessionId}
          agentName={agent.name}
          projectName={chatProjectName}
          onClose={() => setChatSessionId(null)}
        />
      )}

      {/* Delete Agent confirmation */}
      {showDeleteAgent && (
        <DeleteAgentDialog
          agent={agent}
          onConfirm={async () => {
            try {
              await deleteActor(agent.id);
              router.push("/agents");
            } catch (err) {
              alert(err instanceof Error ? err.message : "Failed to delete agent");
            }
          }}
          onClose={() => setShowDeleteAgent(false)}
        />
      )}
    </div>
  );
}

// ─── Delete Agent Dialog ────────────────────────────────────────────────

function DeleteAgentDialog({
  agent,
  onConfirm,
  onClose,
}: {
  agent: Actor;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canConfirm = confirmText === agent.name && !submitting;

  const handleConfirm = async () => {
    setSubmitting(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md">
        <h3 className="font-bold text-lg mb-2">Delete Agent</h3>
        <p className="text-sm text-gray-300 mb-4">
          This will permanently delete <span className="font-semibold text-white">{agent.name}</span> and:
        </p>
        <ul className="text-sm text-gray-400 mb-4 list-disc pl-5 space-y-1">
          <li>All per-project session rows (Claude session ids, OpenAI message histories)</li>
          <li>All wake events (queued, in-progress, history)</li>
          <li>Tasks they were assigned to will become unassigned (the tasks survive)</li>
          <li>Their comments survive but show as having no author</li>
        </ul>
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">
            Type <span className="text-gray-300 font-mono">{agent.name}</span> to confirm:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono focus:outline-none focus:border-red-500"
            autoFocus
          />
        </div>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm font-medium disabled:bg-gray-700 disabled:text-gray-500"
          >
            {submitting ? "Deleting..." : "Delete Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Provider Config Card ───────────────────────────────────────────────

function ProviderConfigCard({ agent, onSaved }: { agent: Actor; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [baseUrl, setBaseUrl] = useState(agent.provider_base_url ?? "");
  const [model, setModel] = useState(agent.provider_model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Reset state when agent changes
  useEffect(() => {
    setBaseUrl(agent.provider_base_url ?? "");
    setModel(agent.provider_model ?? "");
    setApiKey("");
  }, [agent.provider_base_url, agent.provider_model]);

  const handleSave = async (verify: boolean) => {
    setError("");
    setSuccess("");
    if (verify) setVerifying(true);
    else setSaving(true);
    try {
      const data: { base_url?: string; model?: string; api_key?: string } = {
        base_url: baseUrl,
        model: model,
      };
      if (apiKey.trim()) data.api_key = apiKey.trim();
      await updateProviderConfig(agent.id, data, verify);
      setSuccess(verify ? "✓ Connection OK, saved" : "✓ Saved");
      setApiKey("");
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
    setVerifying(false);
    setSaving(false);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">🌐 Provider Config</h3>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded"
          >
            Edit
          </button>
        )}
      </div>
      {!editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-gray-500 text-xs uppercase">Base URL</p>
            <p className="font-mono text-xs truncate">{agent.provider_base_url ?? "—"}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase">Model</p>
            <p className="font-mono text-xs">{agent.provider_model ?? "—"}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase">API Key</p>
            <p className="font-mono text-xs">{agent.provider_api_key ? "•••••••• (set)" : "(not set)"}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              API Key {agent.provider_api_key ? "(leave empty to keep current)" : ""}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          {success && <p className="text-green-400 text-xs">{success}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => handleSave(false)}
              disabled={saving || verifying}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving || verifying}
              className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
            >
              {verifying ? "Testing..." : "Save + Test Connection"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setError("");
                setSuccess("");
                setApiKey("");
              }}
              className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded ml-auto"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Heartbeat Card ─────────────────────────────────────────────────────

function HeartbeatCard({
  agent,
  allAgents,
  onSaved,
}: {
  agent: Actor;
  allAgents: Actor[];
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(agent.heartbeat_enabled ?? false);
  const [interval, setIntervalSec] = useState(agent.heartbeat_interval_seconds ?? 300);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Sync from props on refresh
  useEffect(() => {
    setEnabled(agent.heartbeat_enabled ?? false);
    setIntervalSec(agent.heartbeat_interval_seconds ?? 300);
  }, [agent.heartbeat_enabled, agent.heartbeat_interval_seconds]);

  // Find any OTHER agent that already owns the heartbeat
  const otherOwner = allAgents.find(
    (a) => a.id !== agent.id && a.heartbeat_enabled,
  );

  const handleSave = async () => {
    setError("");
    setSaving(true);
    try {
      await setActorHeartbeat(agent.id, { enabled, interval_seconds: interval });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      // Revert toggle on failure
      setEnabled(agent.heartbeat_enabled ?? false);
    }
    setSaving(false);
  };

  // "Last tick" / "Next tick" labels
  const lastAt = agent.heartbeat_last_at ? new Date(agent.heartbeat_last_at) : null;
  const nextAt =
    lastAt && agent.heartbeat_enabled
      ? new Date(lastAt.getTime() + (agent.heartbeat_interval_seconds ?? 300) * 1000)
      : null;

  const fmtRelative = (d: Date | null) => {
    if (!d) return "—";
    const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
    if (diffSec < -60) return `${Math.abs(Math.round(diffSec / 60))} min ago`;
    if (diffSec < 0) return `${Math.abs(diffSec)}s ago`;
    if (diffSec < 60) return `in ${diffSec}s`;
    return `in ${Math.round(diffSec / 60)} min`;
  };

  const lockedByOther = !!otherOwner && !agent.heartbeat_enabled;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">⏱ Heartbeat</h3>
      {lockedByOther && (
        <div className="bg-yellow-900/20 border border-yellow-800/40 text-yellow-300 text-xs rounded p-2 mb-3">
          Heartbeat is owned by <strong>{otherOwner!.name}</strong>. Disable it there first to enable here.
        </div>
      )}
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            disabled={lockedByOther || saving}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Enable heartbeat</span>
        </label>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Interval (seconds, ≥ 30)</label>
          <input
            type="number"
            min={30}
            value={interval}
            onChange={(e) => setIntervalSec(parseInt(e.target.value) || 30)}
            disabled={!enabled || saving}
            className="w-32 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <span className="text-xs text-gray-600 ml-2">±30s tick resolution</span>
        </div>
        {agent.heartbeat_enabled && (
          <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
            <div>
              <p className="text-gray-500 uppercase">Last tick</p>
              <p>{fmtRelative(lastAt)}</p>
            </div>
            <div>
              <p className="text-gray-500 uppercase">Next tick</p>
              <p>{fmtRelative(nextAt)}</p>
            </div>
          </div>
        )}
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button
          onClick={handleSave}
          disabled={saving || lockedByOther}
          className="self-start text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function EventCard({
  event,
  onClick,
}: {
  event: WakeEvent;
  onClick?: () => void;
}) {
  const inner = (
    <div className="flex items-center justify-between w-full">
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

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="bg-gray-900 border border-gray-800 hover:border-gray-600 hover:bg-gray-800/60 rounded p-3 text-left transition-colors w-full"
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-3">{inner}</div>
  );
}
