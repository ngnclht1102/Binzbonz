"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getActors, createActor, isOpenAIRole, type Actor } from "@/lib/api";

const STATUS_DOT: Record<string, string> = {
  idle: "bg-gray-400",
  working: "bg-green-400 animate-pulse",
  compacting: "bg-yellow-400",
};

const ROLE_BADGE: Record<string, string> = {
  developer: "bg-blue-500/20 text-blue-400",
  master: "bg-purple-500/20 text-purple-400",
  openapidev: "bg-cyan-500/20 text-cyan-400",
  openapicoor: "bg-pink-500/20 text-pink-400",
};

// ─── Provider catalog (OpenAI-compatible) ────────────────────────────────
//
// Each provider has a fixed base URL and a curated model list. To add a new
// provider, drop it in here — the dialog picks it up automatically.

interface OpenAIProvider {
  key: string;
  label: string;
  base_url: string;
  models: string[];
}

const OPENAI_PROVIDERS: OpenAIProvider[] = [
  {
    key: "deepseek",
    label: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    key: "kimi",
    label: "Kimi (Moonshot)",
    base_url: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    key: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-preview", "o1-mini", "o3-mini"],
  },
  {
    key: "groq",
    label: "Groq",
    base_url: "https://api.groq.com/openai/v1",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
    ],
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    models: [
      "openai/gpt-4o",
      "anthropic/claude-3.5-sonnet",
      "google/gemini-pro-1.5",
      "meta-llama/llama-3.3-70b-instruct",
      "mistralai/mistral-large",
    ],
  },
  {
    key: "mistral",
    label: "Mistral AI",
    base_url: "https://api.mistral.ai/v1",
    models: [
      "mistral-large-latest",
      "mistral-small-latest",
      "codestral-latest",
      "ministral-8b-latest",
      "ministral-3b-latest",
    ],
  },
  {
    key: "xai",
    label: "xAI (Grok)",
    base_url: "https://api.x.ai/v1",
    models: ["grok-2", "grok-2-mini", "grok-beta"],
  },
];

type ProviderType = "claude" | "openai_compatible";

function CreateAgentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [providerType, setProviderType] = useState<ProviderType>("claude");

  // Claude-only state
  const [claudeRole, setClaudeRole] = useState<"developer" | "master">("developer");

  // OpenAI-only state
  const [openapiRole, setOpenapiRole] = useState<"openapidev" | "openapicoor">("openapicoor");
  const [providerKey, setProviderKey] = useState<string>(OPENAI_PROVIDERS[0].key);
  const [model, setModel] = useState<string>(OPENAI_PROVIDERS[0].models[0]);
  const [apiKey, setApiKey] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => OPENAI_PROVIDERS.find((p) => p.key === providerKey) ?? OPENAI_PROVIDERS[0],
    [providerKey],
  );

  // Reset model to the first model of the new provider whenever provider changes
  useEffect(() => {
    if (!selectedProvider.models.includes(model)) {
      setModel(selectedProvider.models[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerKey]);

  const handleSubmit = async () => {
    setError("");
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (providerType === "openai_compatible" && !apiKey.trim()) {
      setError("API key is required");
      return;
    }
    setSubmitting(true);
    try {
      if (providerType === "claude") {
        await createActor({
          name: name.trim(),
          type: "agent",
          role: claudeRole,
        });
      } else {
        await createActor({
          name: name.trim(),
          type: "agent",
          role: openapiRole,
          provider_base_url: selectedProvider.base_url,
          provider_model: model,
          provider_api_key: apiKey.trim(),
        });
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
      setSubmitting(false);
    }
  };

  // Test connection: hit {base_url}/models with the API key from the browser.
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const url = `${selectedProvider.base_url.replace(/\/$/, "")}/models`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 401 || res.status === 403) {
        setTestResult("❌ API key rejected");
      } else if (!res.ok) {
        setTestResult(`❌ HTTP ${res.status}`);
      } else {
        const body = (await res.json()) as { data?: { id: string }[] };
        const count = body.data?.length ?? 0;
        setTestResult(`✓ Connected — ${count} models available`);
      }
    } catch (err) {
      setTestResult(`❌ ${err instanceof Error ? err.message : "Network error"}`);
    }
    setTesting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-lg">
        <h3 className="font-bold text-lg mb-4">New Agent</h3>
        <div className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. dev-5, deepseek-coord"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>

          {/* Provider Type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Provider Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setProviderType("claude")}
                className={`text-left px-3 py-2 rounded border text-sm transition-colors ${
                  providerType === "claude"
                    ? "bg-blue-900/30 border-blue-600 text-blue-300"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                <div className="font-medium">🤖 Claude CLI</div>
                <div className="text-xs text-gray-500 mt-0.5">Full code/file/git access</div>
              </button>
              <button
                type="button"
                onClick={() => setProviderType("openai_compatible")}
                className={`text-left px-3 py-2 rounded border text-sm transition-colors ${
                  providerType === "openai_compatible"
                    ? "bg-blue-900/30 border-blue-600 text-blue-300"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                <div className="font-medium">🌐 OpenAI-compatible</div>
                <div className="text-xs text-gray-500 mt-0.5">Coordinator, no file access</div>
              </button>
            </div>
          </div>

          {/* Claude branch */}
          {providerType === "claude" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Role</label>
              <select
                value={claudeRole}
                onChange={(e) => setClaudeRole(e.target.value as "developer" | "master")}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="developer">developer — writes code</option>
                <option value="master">master — coordinates devs</option>
              </select>
            </div>
          )}

          {/* OpenAI branch */}
          {providerType === "openai_compatible" && (
            <div className="bg-gray-800/40 border border-gray-700 rounded p-3 flex flex-col gap-3">
              {/* Provider picker */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Provider</label>
                <select
                  value={providerKey}
                  onChange={(e) => setProviderKey(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
                >
                  {OPENAI_PROVIDERS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 mt-1 font-mono">{selectedProvider.base_url}</p>
              </div>

              {/* Model picker (populated based on provider) */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
                >
                  {selectedProvider.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm font-mono focus:outline-none focus:border-blue-500"
                />
                <p className="text-xs text-gray-600 mt-1">
                  ⚠ Stored in the database. Never returned after save — re-enter to rotate.
                </p>
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Role</label>
                <select
                  value={openapiRole}
                  onChange={(e) => setOpenapiRole(e.target.value as "openapidev" | "openapicoor")}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="openapicoor">openapicoor — coordinator (heartbeat scans)</option>
                  <option value="openapidev">openapidev — lightweight dev assistant</option>
                </select>
              </div>

              {/* Test Connection */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing || !apiKey}
                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded"
                >
                  {testing ? "Testing..." : "Test Connection"}
                </button>
                {testResult && (
                  <p className={`text-xs ${testResult.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>
                    {testResult}
                  </p>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);

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

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Agents</h1>
        <button
          onClick={() => setShowDialog(true)}
          className="w-9 h-9 flex items-center justify-center bg-blue-600 hover:bg-blue-500 rounded-full text-xl font-bold transition-colors shadow-md"
          title="Add new agent"
          aria-label="Add new agent"
        >
          +
        </button>
      </div>

      {showDialog && (
        <CreateAgentDialog onClose={() => setShowDialog(false)} onCreated={fetchAgents} />
      )}

      {loading ? (
        <p className="text-gray-400">Loading agents...</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {agents.map((agent) => {
            const isOpenAI = isOpenAIRole(agent.role);
            return (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${STATUS_DOT[agent.status] ?? "bg-gray-400"}`} />
                  <span title={isOpenAI ? `OpenAI: ${agent.provider_model ?? ""}` : "Claude CLI"}>
                    {isOpenAI ? "🌐" : "🤖"}
                  </span>
                  <span className="font-medium">{agent.name}</span>
                  {agent.heartbeat_enabled && (
                    <span title="Heartbeat enabled" className="text-xs text-yellow-400">⏱</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      ROLE_BADGE[agent.role ?? ""] ?? "bg-gray-700 text-gray-300"
                    }`}
                  >
                    {agent.role}
                  </span>
                  <span className="text-xs text-gray-500">{agent.status}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
