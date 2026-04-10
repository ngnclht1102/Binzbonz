"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getActors, createActor, type Actor } from "@/lib/api";

const STATUS_DOT: Record<string, string> = {
  idle: "bg-gray-400",
  working: "bg-green-400 animate-pulse",
  compacting: "bg-yellow-400",
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [newName, setNewName] = useState("");

  const fetchAgents = async () => {
    const all = await getActors({ type: "agent" });
    setAgents(all);
    setLoading(false);
  };

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createActor({ name: newName.trim(), type: "agent", role: "developer" });
    setNewName("");
    setShowDialog(false);
    fetchAgents();
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Agents</h1>
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
            autoFocus
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
              href={`/agents/${agent.id}`}
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
              {agent.last_active_at && (
                <p className="text-xs text-gray-500 mt-1">
                  Last active: {new Date(agent.last_active_at).toLocaleString()}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
