"use client";
import { useEffect, useState } from "react";
import { browseDirectory, createDirectory, type BrowseResponse } from "@/lib/api";

interface DirectoryPickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function DirectoryPicker({
  initialPath,
  onSelect,
  onClose,
}: DirectoryPickerProps) {
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const loadPath = async (path?: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await browseDirectory(path);
      setData(res);
      setManualPath(res.cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to browse");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPath(initialPath);
  }, [initialPath]);

  const handleManualGo = () => {
    if (manualPath.trim()) loadPath(manualPath.trim());
  };

  const handleCreateFolder = async () => {
    if (!data || !newFolderName.trim()) return;
    setCreatingFolder(true);
    setError("");
    try {
      const res = await createDirectory(data.cwd, newFolderName.trim());
      setNewFolderName("");
      setShowNewFolder(false);
      // Refresh and navigate into the new folder
      await loadPath(res.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
    setCreatingFolder(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg">Browse for Folder</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">
              &times;
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/path/to/folder"
              className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono focus:outline-none focus:border-blue-500"
              onKeyDown={(e) => e.key === "Enter" && handleManualGo()}
            />
            <button
              onClick={handleManualGo}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              Go
            </button>
            <button
              onClick={() => setShowNewFolder(true)}
              disabled={!data}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm disabled:opacity-50"
              title="Create a new folder here"
            >
              + New Folder
            </button>
          </div>

          {/* New folder inline form */}
          {showNewFolder && (
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="folder name"
                className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-green-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
                }}
              />
              <button
                onClick={handleCreateFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm disabled:opacity-50"
              >
                {creatingFolder ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-2">
          {loading && <p className="text-gray-400 p-4">Loading...</p>}
          {error && <p className="text-red-400 p-4 text-sm">{error}</p>}
          {data && !loading && (
            <div className="flex flex-col">
              {/* Parent / up navigation */}
              {data.parent && (
                <button
                  onClick={() => loadPath(data.parent!)}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800 rounded text-sm text-gray-300"
                >
                  <span className="text-gray-500">↑</span>
                  <span>..</span>
                </button>
              )}
              {data.entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => loadPath(entry.path)}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800 rounded text-sm text-gray-200 text-left"
                >
                  <span className="text-yellow-500">📁</span>
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
              {data.entries.length === 0 && !data.parent && (
                <p className="text-gray-500 p-4 text-sm">Empty directory</p>
              )}
              {data.entries.length === 0 && data.parent && (
                <p className="text-gray-500 p-4 text-sm">No subdirectories</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400 truncate font-mono">
            {data?.cwd ?? ""}
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => data && onSelect(data.cwd)}
              disabled={!data}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm disabled:opacity-50"
            >
              Select This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
