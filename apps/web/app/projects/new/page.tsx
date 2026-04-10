"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProject } from "@/lib/api";
import DirectoryPicker from "@/components/directory-picker";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !brief.trim()) {
      setError("Name and brief are required");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const data: { name: string; brief: string; repo_path?: string } = {
        name: name.trim(),
        brief: brief.trim(),
      };
      if (workspacePath.trim()) {
        data.repo_path = workspacePath.trim();
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
            placeholder="Describe what this project should build..."
          />
        </div>
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
            Absolute path for the project workspace. Leave empty for default (~/.binzbonz/projects/).
          </p>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Project"}
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
          initialPath={workspacePath || undefined}
          onSelect={(path) => {
            setWorkspacePath(path);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
