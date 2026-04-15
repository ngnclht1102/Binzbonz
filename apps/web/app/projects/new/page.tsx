"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProject } from "@/lib/api";
import DirectoryPicker from "@/components/directory-picker";

type Mode = "create" | "import";

export default function NewProjectPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [importPath, setImportPath] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !brief.trim()) {
      setError("Name and brief are required");
      return;
    }
    if (mode === "import" && !importPath.trim()) {
      setError("Import path is required");
      return;
    }
    if (mode === "import" && !importPath.trim().startsWith("/")) {
      setError("Import path must be an absolute path");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const data: {
        name: string;
        brief: string;
        repo_path?: string;
        import_path?: string;
      } = {
        name: name.trim(),
        brief: brief.trim(),
      };
      if (mode === "create" && workspacePath.trim()) {
        data.repo_path = workspacePath.trim();
      }
      if (mode === "import") {
        data.import_path = importPath.trim();
      }
      const project = await createProject(data);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-2xl font-bold mb-6">New Project</h1>

      {/* Mode toggle */}
      <div className="inline-flex bg-gray-900 border border-gray-700 rounded p-0.5 mb-6">
        <button
          type="button"
          onClick={() => {
            setMode("create");
            setError("");
          }}
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            mode === "create"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Create new
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("import");
            setError("");
          }}
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            mode === "import"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Import existing
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500"
            placeholder="Project name"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Brief</label>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500 resize-none"
            placeholder={
              mode === "create"
                ? "Describe what this project should build..."
                : "Describe what the imported project is about so agents have context..."
            }
          />
        </div>

        {mode === "create" ? (
          <div>
            <label className="block text-sm font-medium mb-1">
              Workspace Path
              <span className="text-gray-500 font-normal ml-1">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={workspacePath}
                onChange={(e) => setWorkspacePath(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500 font-mono text-sm"
                placeholder="e.g. /Users/you/Work/my-app"
              />
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors shrink-0"
              >
                Browse...
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Absolute path for the project workspace. Leave empty for default
              (~/.binzbonz/projects/).
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">
              Import Path
              <span className="text-red-400 ml-1">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500 font-mono text-sm"
                placeholder="/Users/you/Work/existing-repo"
              />
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors shrink-0"
              >
                Browse...
              </button>
            </div>
            <div className="mt-2 text-xs text-gray-400 space-y-1 bg-gray-900/60 border border-gray-800 rounded p-3">
              <p className="text-gray-300 font-medium">Import is non-destructive:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-gray-500">
                <li>Existing <code className="font-mono">CLAUDE.md</code> is never overwritten — kept as-is.</li>
                <li>A <code className="font-mono">binzbonz.md</code> config is created only if missing.</li>
                <li>If the directory is already a git repo, <code className="font-mono">.git</code> is left alone.</li>
                <li><code className="font-mono">skills/</code>, <code className="font-mono">memory/</code>, <code className="font-mono">worktrees/</code> are created only if missing.</li>
              </ul>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500 border-l-2 border-gray-700 pl-3">
          Project settings (peer review, branch naming, auto-merge) live in{" "}
          <code className="font-mono text-gray-400">binzbonz.md</code> inside
          the project workspace. To change them later, edit that file directly
          — there is no settings UI.
        </p>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            {submitting
              ? mode === "import"
                ? "Importing..."
                : "Creating..."
              : mode === "import"
              ? "Import Project"
              : "Create Project"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/projects")}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>

      {showPicker && (
        <DirectoryPicker
          initialPath={
            mode === "import"
              ? importPath || undefined
              : workspacePath || undefined
          }
          onSelect={(path) => {
            if (mode === "import") {
              setImportPath(path);
            } else {
              setWorkspacePath(path);
            }
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
