"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { useActorsStore } from "@/lib/stores/actors-store";
import { useEventsStore } from "@/lib/stores/events-store";

const STATUS_COLORS: Record<string, string> = {
  analysing: "bg-yellow-500/20 text-yellow-400",
  paused: "bg-gray-500/20 text-gray-400",
  active: "bg-green-500/20 text-green-400",
  completed: "bg-blue-500/20 text-blue-400",
};

const STATUS_DOT: Record<string, string> = {
  idle: "bg-gray-400",
  working: "bg-green-400 animate-pulse",
  compacting: "bg-yellow-400",
};

export default function AgentPoolPage() {
  const params = useParams();
  const id = params.id as string;
  const { activeProject, fetchProject } = useProjectsStore();
  const { agents, loading, fetchAgents, createAgent } = useActorsStore();
  const { connect, disconnect, onEvent } = useEventsStore();
  const [showDialog, setShowDialog] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    fetchProject(id);
    fetchAgents();
    connect();
    return () => disconnect();
  }, [id, fetchProject, fetchAgents, connect, disconnect]);

  useEffect(() => {
    const unsub = onEvent("wake_event_change", () => fetchAgents());
    return unsub;
  }, [onEvent, fetchAgents]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createAgent(newName.trim());
    setNewName("");
    setShowDialog(false);
  };

  const tabs = [
    { label: "Board", href: `/projects/${id}` },
    { label: "Tree", href: `/projects/${id}/tree` },
    { label: "Agents", href: `/projects/${id}/agents` },
    { label: "Files", href: `/projects/${id}/files` },
  ];

  return (
    <div className="p-8">
      {activeProject && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold">{activeProject.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[activeProject.status] ?? "bg-gray-700"}`}>
              {activeProject.status}
            </span>
          </div>
          <p className="text-gray-400 text-sm">{activeProject.brief}</p>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-800 mb-6">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab.href.endsWith("/agents")
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Agent Pool</h2>
        <button
          onClick={() => setShowDialog(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
        >
          Create Agent
        </button>
      </div>

      {showDialog && (
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Agent name"
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button onClick={handleCreate} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm">
            Add
          </button>
          <button onClick={() => setShowDialog(false)} className="px-3 py-1.5 bg-gray-700 rounded text-sm">
            Cancel
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Loading agents...</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/projects/${id}/agents/${agent.id}`}
              className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${STATUS_DOT[agent.status] ?? "bg-gray-400"}`} />
                <span className="font-medium">{agent.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    agent.role === "ctbaceo"
                      ? "bg-purple-500/20 text-purple-400"
                      : "bg-blue-500/20 text-blue-400"
                  }`}
                >
                  {agent.role}
                </span>
                <span className="text-xs text-gray-500">{agent.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
