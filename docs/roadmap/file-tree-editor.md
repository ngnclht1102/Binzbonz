# File Tree + Editor

## Goal

Add a **Files** tab to each project that lets the human:
1. Browse the project's workspace as a file tree
2. Open files in an inline editor (Monaco)
3. Edit and save text files
4. Copy / cut / paste / move / rename / delete files and folders
5. Create new files and folders
6. See changes that agents make to files (poll every 5s)

This complements the agent runner — agents work via the CLI in the project directory, the human can inspect and intervene through the UI.

---

## UI Layout

New tab on the project detail page:

```
Board | Tree | Agents | Files
```

The **Files** tab is a split layout:

```
┌──────────────────────────────────────────────────────┐
│ Files                       [+ File] [+ Folder] [↻] │
├─────────────────┬────────────────────────────────────┤
│ ▾ src/          │  src/main.ts                       │
│   ▸ components/ │ ┌────────────────────────────────┐ │
│   ▸ lib/        │ │ Monaco editor                  │ │
│   ▾ pages/      │ │  with syntax highlighting      │ │
│     · index.tsx │ │                                │ │
│     · about.tsx │ │                                │ │
│   · main.ts ●   │ │                                │ │
│ ▸ public/       │ └────────────────────────────────┘ │
│ · package.json  │                                    │
│ · README.md     │ [Save]   unsaved changes •         │
└─────────────────┴────────────────────────────────────┘
```

- **Left pane**: collapsible file tree, lazy-loaded per folder
- **Right pane**: Monaco editor for the selected file (single-file editing only)
- **Unsaved indicator**: `●` next to the file name in the tree, plus a footer note
- **Save button** + Cmd/Ctrl+S keybinding
- **Toolbar**: "+ File", "+ Folder", "Refresh"
- **Right-click context menu** on files/folders: Copy, Cut, Paste, Rename, Delete

---

## Backend API

All endpoints are scoped to a project. Every endpoint **must** validate that the resolved path is inside `project.repo_path` and return 403 if not.

```
GET    /projects/:id/files?path=                       List directory contents
GET    /projects/:id/files/read?path=                  Read file content (UTF-8)
POST   /projects/:id/files/write { path, content }     Write file (overwrite)
POST   /projects/:id/files/mkdir { parent, name }      Create folder
POST   /projects/:id/files/touch { parent, name }      Create empty file
DELETE /projects/:id/files?path=                       Delete file or folder (recursive)
POST   /projects/:id/files/copy { from, to }           Copy file or folder
POST   /projects/:id/files/move { from, to }           Move/rename
GET    /projects/:id/files/stat?path=                  Get mtime, size — used by poll
```

### `GET /projects/:id/files?path=`

Lists entries in a directory. Defaults to project root.

```json
{
  "cwd": "/abs/path/to/project/src",
  "relative": "src",
  "parent": "/abs/path/to/project",
  "entries": [
    { "name": "components", "is_directory": true,  "size": null,  "mtime": "..." },
    { "name": "main.ts",    "is_directory": false, "size": 1234,  "mtime": "..." }
  ]
}
```

### `GET /projects/:id/files/read?path=`

```json
{
  "path": "/abs/.../main.ts",
  "content": "import...",
  "mtime": "2026-04-10T10:00:00Z",
  "size": 1234,
  "is_binary": false
}
```

- Reject files >1MB → return `{"error": "file_too_large"}`
- Detect binary by null-byte sniff in first 8KB → return `{"is_binary": true, "content": ""}`
- Use `mtime` as the version token for conflict detection (see "Save & conflicts" below)

### `POST /projects/:id/files/write`

```json
{
  "path": "/abs/.../main.ts",
  "content": "...",
  "expected_mtime": "2026-04-10T10:00:00Z"   // optional, for conflict check
}
```

- Reject content >5MB
- If `expected_mtime` is provided and current mtime on disk differs → return 409 Conflict with current content (let frontend resolve)
- After write, return new `mtime`

### `GET /projects/:id/files/stat?path=`

Cheap endpoint for the 5s poll loop. Returns just `mtime` and `size`.

```json
{ "mtime": "2026-04-10T10:00:05Z", "size": 1245 }
```

---

## Path Containment

Critical security check applied to every endpoint:

```ts
function ensureInProject(projectRoot: string, userPath: string): string {
  const resolved = resolve(projectRoot, userPath);
  const root = resolve(projectRoot);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new ForbiddenException('Path escape blocked');
  }
  return resolved;
}
```

- Always resolve paths first (handles `..`, symlinks, etc.)
- Compare against the resolved project root
- Block any path that's not equal to root or a descendant of root

---

## Hidden Paths (Hardcoded Ignore List)

These directories/files are **never returned** by listing endpoints, and **always rejected** by read/write/etc. Hardcoded in the controller:

```ts
const IGNORED_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'target',           // Rust
  'vendor',           // PHP / Go
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
  '.mypy_cache',
  '.tox',
  'coverage',
  '.nyc_output',
  'tmp',
  '.DS_Store',
  'data/postgres',    // our embedded postgres
]);

const IGNORED_FILE_EXTS = new Set([
  '.lock',     // package-lock, pnpm-lock, etc.
  '.log',
  '.pyc',
]);

const IGNORED_FILES = new Set([
  '.DS_Store',
  'Thumbs.db',
]);
```

These can NEVER be read or written via the API, even with explicit paths. Defense in depth.

---

## File Size Limits

| Operation | Limit | Behavior |
|---|---|---|
| Read | 1 MB | 413 with `file_too_large` |
| Write | 5 MB | 413 with `file_too_large` |
| Binary file | (any) | Return `is_binary: true, content: ""` — UI shows "binary file, can't edit" |

Binary detection: read first 8KB, look for null bytes (`\0`). If found → binary.

---

## Frontend Plan

### New route: not needed
Files tab is part of the project detail page (`/projects/:id`). Add as a new tab next to Board / Tree / Agents.

### New components

1. **`FilesPage`** — owns the split layout, fetches root listing
2. **`FileTreeNode`** — recursive tree node, lazy-loads children on expand
3. **`FileEditor`** — wraps Monaco, manages content state, save button
4. **`FileContextMenu`** — right-click menu (copy/cut/paste/delete/rename)

### Editor: Monaco

Install:
```bash
pnpm --filter @binzbonz/web add @monaco-editor/react
```

Use the React wrapper, not raw Monaco. Configure:
- Theme: `vs-dark` to match the app
- Auto-detect language from file extension
- `wordWrap: 'on'`
- `minimap: { enabled: false }` for the small editor pane
- `fontSize: 13`, same as the web terminal

### State management

Local component state is fine — no need for a Zustand store. State per FilesPage:

```ts
{
  rootListing: BrowseResponse | null,
  expandedFolders: Set<string>,
  childListings: Map<string, BrowseResponse>,
  selectedFile: { path: string, content: string, mtime: string } | null,
  editedContent: string | null,    // null if no unsaved edits
  clipboard: { mode: 'copy' | 'cut', path: string } | null,
}
```

### Lazy loading

When a folder is expanded, fetch its contents on demand and cache in `childListings`. Collapse just hides children but keeps the cache. Refresh button clears cache and re-fetches everything.

### Polling for external changes (every 5s)

Only poll the **currently-open file**:

```ts
useEffect(() => {
  if (!selectedFile) return;
  const interval = setInterval(async () => {
    const stat = await getFileStat(projectId, selectedFile.path);
    if (stat.mtime !== selectedFile.mtime) {
      // File changed on disk
      if (editedContent === null || editedContent === selectedFile.content) {
        // No unsaved changes — silently reload
        const fresh = await readFile(projectId, selectedFile.path);
        setSelectedFile(fresh);
      } else {
        // Conflict — warn user
        setExternalChange(true);
      }
    }
  }, 5000);
  return () => clearInterval(interval);
}, [selectedFile, editedContent]);
```

If externally changed AND user has unsaved changes:
- Show banner: "This file was modified outside the editor. [Reload] [Keep my version]"
- Reload → discard local changes, refetch
- Keep → keep editing, but the next save will fail with 409 unless we drop the `expected_mtime` check

Optionally also poll the open folder's listing to detect new files added by agents — but that's more API calls. Skip for v1.

### Save & conflicts

- Save sends `{ path, content, expected_mtime }`
- If 409 Conflict → show banner: "File was modified externally. [Discard their changes (overwrite)] [Reload]"

### Copy / cut / paste

Tracked in client state, not OS clipboard.

```
Right-click file → Copy → clipboard = { mode: 'copy', path: '...' }
Right-click folder → Paste → POST /files/copy { from: clipboard.path, to: folder + filename }
```

For Cut: same flow but call `/files/move` and clear the clipboard after.

If pasting into the same parent dir, the new file gets ` (copy)` appended to its name to avoid collision.

### Keyboard shortcuts

- **Cmd/Ctrl+S**: save current file
- **Cmd/Ctrl+C** in tree: copy selected node
- **Cmd/Ctrl+X** in tree: cut selected node
- **Cmd/Ctrl+V** in tree: paste into selected folder
- **Delete**: delete selected node (with confirm dialog)
- **F2**: rename selected node

These are tree-level shortcuts only. Inside Monaco, all the standard editor shortcuts work as usual.

---

## Implementation Order

1. **Backend: filesystem module** — extend the existing `FilesystemController` or create a new `ProjectFilesController`. New endpoints with path containment + ignore list.
2. **API client** — add `lib/api.ts` functions for all the new endpoints.
3. **Files tab** — basic file tree on the left, no editor yet. Lazy-load on expand. Verify ignore list works.
4. **Read + Monaco** — install Monaco, wire selected file → editor.
5. **Write + save** — Save button, Cmd/Ctrl+S, dirty indicator.
6. **5s poll for external changes** — auto-reload if no unsaved edits, conflict banner if there are.
7. **Create file / folder** — toolbar buttons + dialogs.
8. **Delete** — context menu + confirm dialog.
9. **Rename** — F2 / context menu, inline input.
10. **Copy / cut / paste** — context menu + clipboard state.
11. **Polish** — empty states, loading spinners, error toasts.

---

## What's NOT in scope

These are explicitly excluded for v1, listed here so we don't scope-creep:

- **Multiple open files / tabs** — single-file editing only
- **Diff view against git HEAD** — no git integration
- **Search across files** — no global search
- **Drag-and-drop** in the file tree — context menu only
- **File upload from local machine** — no
- **Image preview** — show "binary file, can't edit"
- **Folder polling** — only the open file is polled, not the tree
- **fs.watch / SSE for live updates** — periodic poll is enough
- **Permissions** — no per-file permissions, the whole workspace is read/write
- **Edit history / undo beyond Monaco's built-in** — no version history

---

## Open questions

- Should the tree show file size next to filenames? (My pick: no, too noisy)
- Should we show a small "modified by agent" badge if an agent recently touched the file? (Future: link `memory_file` table or git blame)
- What happens if the project's `repo_path` doesn't exist on disk? (Show empty state with a "directory not found" message)
- Should we allow editing files that are `.gitignore`d but not in our hardcoded ignore list? (My pick: yes — agents may need to inspect `.env` for example. Only the hardcoded list is blocked.)
