"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useProjectsStore } from "@/lib/stores/projects-store";
import {
  browseProjectFiles,
  readProjectFile,
  writeProjectFile,
  statProjectFile,
  mkdirProjectFile,
  touchProjectFile,
  deleteProjectFile,
  copyProjectFile,
  moveProjectFile,
  type ProjectFileBrowse,
  type ProjectFileEntry,
  type ProjectFileRead,
} from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  analysing: "bg-yellow-500/20 text-yellow-400",
  paused: "bg-gray-500/20 text-gray-400",
  active: "bg-green-500/20 text-green-400",
  completed: "bg-blue-500/20 text-blue-400",
};

// Monaco Editor (dynamic to avoid SSR)
const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

// Map file extension to monaco language
function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    sql: "sql",
    xml: "xml",
    dockerfile: "dockerfile",
  };
  if (lower === "dockerfile") return "dockerfile";
  return map[ext] ?? "plaintext";
}

interface ClipboardEntry {
  mode: "copy" | "cut";
  path: string;
  name: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  name: string;
  is_directory: boolean;
}

interface FileTreeNodeProps {
  projectId: string;
  entry: ProjectFileEntry;
  parentPath: string;
  depth: number;
  selectedPath: string | null;
  expandedFolders: Set<string>;
  childListings: Map<string, ProjectFileBrowse>;
  unsaved: boolean;
  onSelectFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: ProjectFileEntry, parentPath: string) => void;
}

function FileTreeNode({
  projectId,
  entry,
  parentPath,
  depth,
  selectedPath,
  expandedFolders,
  childListings,
  unsaved,
  onSelectFile,
  onToggleFolder,
  onContextMenu,
}: FileTreeNodeProps) {
  const fullPath = `${parentPath}/${entry.name}`;
  const isExpanded = expandedFolders.has(fullPath);
  const children = childListings.get(fullPath);
  const isSelected = selectedPath === fullPath;
  const handleClick = () => {
    if (entry.is_directory) {
      onToggleFolder(fullPath);
    } else {
      onSelectFile(fullPath);
    }
  };
  return (
    <div>
      <div
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, entry, parentPath)}
        className={`flex items-center gap-1 py-0.5 px-1 cursor-pointer hover:bg-gray-800 rounded text-sm ${
          isSelected ? "bg-blue-900/40 text-blue-300" : "text-gray-300"
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        title={entry.name}
      >
        <span className="w-3 text-gray-500 text-xs shrink-0">
          {entry.is_directory ? (isExpanded ? "▾" : "▸") : ""}
        </span>
        <span className="shrink-0">{entry.is_directory ? "📁" : "📄"}</span>
        <span className="truncate">{entry.name}</span>
        {!entry.is_directory && isSelected && unsaved && (
          <span className="text-orange-400 ml-1 shrink-0">●</span>
        )}
      </div>
      {entry.is_directory && isExpanded && children && (
        <div>
          {children.entries.length === 0 ? (
            <div
              className="text-xs text-gray-600 italic py-0.5"
              style={{ paddingLeft: `${(depth + 1) * 12 + 16}px` }}
            >
              empty
            </div>
          ) : (
            children.entries.map((child) => (
              <FileTreeNode
                key={`${fullPath}/${child.name}`}
                projectId={projectId}
                entry={child}
                parentPath={fullPath}
                depth={depth + 1}
                selectedPath={selectedPath}
                expandedFolders={expandedFolders}
                childListings={childListings}
                unsaved={unsaved}
                onSelectFile={onSelectFile}
                onToggleFolder={onToggleFolder}
                onContextMenu={onContextMenu}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectFilesPage() {
  const params = useParams();
  const pathname = usePathname();
  const id = params.id as string;
  const { activeProject, fetchProject } = useProjectsStore();

  const [rootListing, setRootListing] = useState<ProjectFileBrowse | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [childListings, setChildListings] = useState<Map<string, ProjectFileBrowse>>(
    new Map(),
  );
  const [selectedFile, setSelectedFile] = useState<ProjectFileRead | null>(null);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [error, setError] = useState("");
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // ----------------------------------------------------------------
  // Initial load
  // ----------------------------------------------------------------
  useEffect(() => {
    fetchProject(id);
  }, [id, fetchProject]);

  const loadRoot = useCallback(async () => {
    try {
      const root = await browseProjectFiles(id);
      setRootListing(root);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    }
  }, [id]);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot]);

  // ----------------------------------------------------------------
  // Folder expansion (lazy load)
  // ----------------------------------------------------------------
  const toggleFolder = useCallback(
    async (path: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
      // Fetch if not cached
      if (!childListings.has(path)) {
        try {
          const listing = await browseProjectFiles(id, path);
          setChildListings((prev) => {
            const next = new Map(prev);
            next.set(path, listing);
            return next;
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load folder");
        }
      }
    },
    [id, childListings],
  );

  const refreshAll = useCallback(async () => {
    setChildListings(new Map());
    await loadRoot();
    // Re-fetch all expanded folders
    const fresh = new Map<string, ProjectFileBrowse>();
    for (const path of expandedFolders) {
      try {
        const listing = await browseProjectFiles(id, path);
        fresh.set(path, listing);
      } catch {
        // ignore — folder may have been deleted
      }
    }
    setChildListings(fresh);
  }, [id, loadRoot, expandedFolders]);

  const refreshFolder = useCallback(
    async (path: string) => {
      try {
        const listing = await browseProjectFiles(id, path);
        setChildListings((prev) => {
          const next = new Map(prev);
          next.set(path, listing);
          return next;
        });
      } catch {
        // ignore
      }
    },
    [id],
  );

  // ----------------------------------------------------------------
  // File selection
  // ----------------------------------------------------------------
  const selectFile = useCallback(
    async (path: string) => {
      // Discard unsaved changes guard
      if (selectedFile && editedContent !== null && editedContent !== selectedFile.content) {
        if (!confirm("You have unsaved changes. Discard them?")) return;
      }
      try {
        const file = await readProjectFile(id, path);
        setSelectedFile(file);
        setEditedContent(null);
        setExternalChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read file");
      }
    },
    [id, selectedFile, editedContent],
  );

  // ----------------------------------------------------------------
  // Save
  // ----------------------------------------------------------------
  const save = useCallback(async () => {
    if (!selectedFile) return;
    if (editedContent === null) return;
    try {
      const result = await writeProjectFile(id, {
        path: selectedFile.path,
        content: editedContent,
        expected_mtime: externalChange ? undefined : selectedFile.mtime,
      });
      setSelectedFile({
        ...selectedFile,
        content: editedContent,
        mtime: result.mtime,
        size: result.size,
      });
      setEditedContent(null);
      setExternalChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      if (msg.toLowerCase().includes("conflict") || msg.toLowerCase().includes("modified externally")) {
        setExternalChange(true);
      }
      setError(msg);
    }
  }, [id, selectedFile, editedContent, externalChange]);

  // ----------------------------------------------------------------
  // Cmd/Ctrl+S keybinding
  // ----------------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  // ----------------------------------------------------------------
  // 5s poll for external changes
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!selectedFile) return;
    const interval = setInterval(async () => {
      try {
        const stat = await statProjectFile(id, selectedFile.path);
        if (stat.mtime !== selectedFile.mtime) {
          // File changed on disk
          if (editedContent === null || editedContent === selectedFile.content) {
            // Silent reload
            const fresh = await readProjectFile(id, selectedFile.path);
            setSelectedFile(fresh);
            setEditedContent(null);
          } else {
            setExternalChange(true);
          }
        }
      } catch {
        // ignore — file may have been deleted
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [id, selectedFile, editedContent]);

  // ----------------------------------------------------------------
  // Context menu close on outside click
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  // ----------------------------------------------------------------
  // Toolbar actions
  // ----------------------------------------------------------------
  const newFile = async () => {
    if (!rootListing) return;
    // Create at root unless a folder is currently selected via context (we use root for simplicity)
    const name = prompt("New file name:");
    if (!name) return;
    try {
      await touchProjectFile(id, rootListing.cwd, name);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file");
    }
  };

  const newFolder = async () => {
    if (!rootListing) return;
    const name = prompt("New folder name:");
    if (!name) return;
    try {
      await mkdirProjectFile(id, rootListing.cwd, name);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
  };

  // ----------------------------------------------------------------
  // Context menu actions
  // ----------------------------------------------------------------
  const handleContextMenu = (
    e: React.MouseEvent,
    entry: ProjectFileEntry,
    parentPath: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path: `${parentPath}/${entry.name}`,
      name: entry.name,
      is_directory: entry.is_directory,
    });
  };

  const ctxCopy = () => {
    if (!contextMenu) return;
    setClipboard({ mode: "copy", path: contextMenu.path, name: contextMenu.name });
    setContextMenu(null);
  };
  const ctxCut = () => {
    if (!contextMenu) return;
    setClipboard({ mode: "cut", path: contextMenu.path, name: contextMenu.name });
    setContextMenu(null);
  };
  const ctxPaste = async () => {
    if (!contextMenu || !clipboard) return;
    if (!contextMenu.is_directory) {
      setError("Can only paste into a folder");
      setContextMenu(null);
      return;
    }
    let destName = clipboard.name;
    let dest = `${contextMenu.path}/${destName}`;
    // If pasting copy into the same parent, append " (copy)"
    const sourceParent = clipboard.path.slice(0, clipboard.path.lastIndexOf("/"));
    if (clipboard.mode === "copy" && sourceParent === contextMenu.path) {
      const dot = destName.lastIndexOf(".");
      if (dot > 0) {
        destName = `${destName.slice(0, dot)} (copy)${destName.slice(dot)}`;
      } else {
        destName = `${destName} (copy)`;
      }
      dest = `${contextMenu.path}/${destName}`;
    }
    try {
      if (clipboard.mode === "copy") {
        await copyProjectFile(id, clipboard.path, dest);
      } else {
        await moveProjectFile(id, clipboard.path, dest);
        setClipboard(null);
      }
      await refreshFolder(contextMenu.path);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to paste");
    }
    setContextMenu(null);
  };
  const ctxDelete = async () => {
    if (!contextMenu) return;
    if (!confirm(`Delete ${contextMenu.is_directory ? "folder" : "file"} "${contextMenu.name}"?`)) {
      setContextMenu(null);
      return;
    }
    try {
      await deleteProjectFile(id, contextMenu.path);
      // Clear selection if the deleted file is open
      if (selectedFile && selectedFile.path === contextMenu.path) {
        setSelectedFile(null);
        setEditedContent(null);
      }
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
    setContextMenu(null);
  };
  const ctxRename = async () => {
    if (!contextMenu) return;
    const target = contextMenu;
    setContextMenu(null);
    const newName = prompt("Rename to:", target.name);
    if (!newName || newName.trim() === target.name) return;
    const parent = target.path.slice(0, target.path.lastIndexOf("/"));
    const dest = `${parent}/${newName.trim()}`;
    try {
      await moveProjectFile(id, target.path, dest);
      if (selectedFile && selectedFile.path === target.path) {
        const fresh = await readProjectFile(id, dest);
        setSelectedFile(fresh);
        setEditedContent(null);
      }
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    }
  };
  const ctxNewFileHere = async () => {
    if (!contextMenu || !contextMenu.is_directory) return;
    const name = prompt("New file name:");
    setContextMenu(null);
    if (!name) return;
    try {
      await touchProjectFile(id, contextMenu.path, name);
      await refreshFolder(contextMenu.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file");
    }
  };
  const ctxNewFolderHere = async () => {
    if (!contextMenu || !contextMenu.is_directory) return;
    const name = prompt("New folder name:");
    setContextMenu(null);
    if (!name) return;
    try {
      await mkdirProjectFile(id, contextMenu.path, name);
      await refreshFolder(contextMenu.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
  };

  const tabs = [
    { label: "Board", href: `/projects/${id}` },
    { label: "Tree", href: `/projects/${id}/tree` },
    { label: "Agents", href: `/projects/${id}/agents` },
    { label: "Files", href: `/projects/${id}/files` },
  ];

  if (!activeProject) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  const isDirty = editedContent !== null && selectedFile !== null && editedContent !== selectedFile.content;

  return (
    <div className="p-8 h-screen flex flex-col">
      {/* Project header */}
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold">{activeProject.name}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[activeProject.status] ?? "bg-gray-700"}`}>
            {activeProject.status}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-gray-800 mb-4 shrink-0">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                pathname === tab.href
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        <div className="flex gap-2 mb-1">
          <button
            onClick={newFile}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
          >
            + File
          </button>
          <button
            onClick={newFolder}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
          >
            + Folder
          </button>
          <button
            onClick={refreshAll}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-2 px-3 py-2 bg-red-900/30 border border-red-800 rounded text-red-300 text-sm flex items-center justify-between shrink-0">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-300 hover:text-white">×</button>
        </div>
      )}

      {/* Split layout */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left: tree */}
        <div className="w-72 shrink-0 bg-gray-900 border border-gray-800 rounded p-2 overflow-auto">
          {!rootListing ? (
            <p className="text-gray-500 text-sm">Loading...</p>
          ) : rootListing.entries.length === 0 ? (
            <p className="text-gray-500 text-sm">Empty workspace</p>
          ) : (
            rootListing.entries.map((entry) => {
              const fullPath = `${rootListing.cwd}/${entry.name}`;
              return (
                <FileTreeNode
                  key={fullPath}
                  projectId={id}
                  entry={entry}
                  parentPath={rootListing.cwd}
                  depth={0}
                  selectedPath={selectedFile?.path ?? null}
                  expandedFolders={expandedFolders}
                  childListings={childListings}
                  unsaved={isDirty}
                  onSelectFile={selectFile}
                  onToggleFolder={toggleFolder}
                  onContextMenu={handleContextMenu}
                />
              );
            })
          )}
        </div>

        {/* Right: editor */}
        <div className="flex-1 bg-gray-900 border border-gray-800 rounded flex flex-col min-w-0">
          {!selectedFile ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              Select a file to edit
            </div>
          ) : selectedFile.is_binary ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-1">
              <span>Binary file — cannot edit</span>
              <span className="text-xs text-gray-600">{selectedFile.path}</span>
            </div>
          ) : (
            <>
              {/* Editor header */}
              <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between shrink-0">
                <div className="text-sm text-gray-300 truncate">
                  {selectedFile.path.replace(rootListing?.cwd ?? "", "") || selectedFile.path}
                  {isDirty && <span className="text-orange-400 ml-2">●</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-gray-500">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </span>
                  <button
                    onClick={save}
                    disabled={!isDirty}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* External change banner */}
              {externalChange && (
                <div className="px-3 py-2 bg-yellow-900/30 border-b border-yellow-800 text-yellow-300 text-xs flex items-center justify-between shrink-0">
                  <span>This file was modified outside the editor.</span>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        try {
                          const fresh = await readProjectFile(id, selectedFile.path);
                          setSelectedFile(fresh);
                          setEditedContent(null);
                          setExternalChange(false);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Failed to reload");
                        }
                      }}
                      className="px-2 py-0.5 bg-yellow-700 hover:bg-yellow-600 rounded text-xs"
                    >
                      Reload
                    </button>
                    <button
                      onClick={() => setExternalChange(false)}
                      className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
                    >
                      Keep mine
                    </button>
                  </div>
                </div>
              )}

              {/* Monaco */}
              <div className="flex-1 min-h-0">
                <Monaco
                  height="100%"
                  theme="vs-dark"
                  language={detectLanguage(selectedFile.path)}
                  value={editedContent ?? selectedFile.content}
                  onChange={(value) => setEditedContent(value ?? "")}
                  options={{
                    fontSize: 13,
                    minimap: { enabled: false },
                    wordWrap: "on",
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50 text-sm min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.is_directory && (
            <>
              <button
                onClick={ctxNewFileHere}
                className="w-full text-left px-3 py-1 hover:bg-gray-700 text-gray-200"
              >
                New File
              </button>
              <button
                onClick={ctxNewFolderHere}
                className="w-full text-left px-3 py-1 hover:bg-gray-700 text-gray-200"
              >
                New Folder
              </button>
              <div className="border-t border-gray-700 my-1"></div>
            </>
          )}
          <button
            onClick={ctxCopy}
            className="w-full text-left px-3 py-1 hover:bg-gray-700 text-gray-200"
          >
            Copy
          </button>
          <button
            onClick={ctxCut}
            className="w-full text-left px-3 py-1 hover:bg-gray-700 text-gray-200"
          >
            Cut
          </button>
          {contextMenu.is_directory && clipboard && (
            <button
              onClick={ctxPaste}
              className="w-full text-left px-3 py-1 hover:bg-gray-700 text-gray-200"
            >
              Paste {clipboard.name}
            </button>
          )}
          <div className="border-t border-gray-700 my-1"></div>
          <button
            onClick={ctxRename}
            className="w-full text-left px-3 py-1 hover:bg-gray-700 text-gray-200"
          >
            Rename
          </button>
          <button
            onClick={ctxDelete}
            className="w-full text-left px-3 py-1 hover:bg-gray-700 text-red-400"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
