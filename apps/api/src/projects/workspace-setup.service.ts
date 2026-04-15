import { Injectable, Logger } from '@nestjs/common';
import { mkdirSync, writeFileSync, existsSync, copyFileSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

export interface WorkspacePaths {
  repo_path: string;
  worktree_path: string;
  claude_md_path: string;
  /** True if at least one scaffolding step actually wrote a file. Lets the
   *  caller distinguish "fresh project" from "nothing to do, everything
   *  already existed" when reporting the import outcome. */
  wroteAnything: boolean;
}

export interface SetupOptions {
  /** Project display name — used to derive a default slug when `customPath`
   *  is not provided. */
  name: string;
  /** Project UUID — first 8 chars suffixed to the default slug. */
  id: string;
  /** Optional caller-supplied path. For imports this is an existing
   *  directory; for creates it's a fresh (or to-be-created) directory. */
  customPath?: string | null;
  /** True when the caller is importing an existing directory. In import
   *  mode we NEVER write .git (if already a repo), NEVER overwrite files
   *  the user already has, and never commit anything. */
  isImport?: boolean;
}

@Injectable()
export class WorkspaceSetupService {
  private readonly logger = new Logger(WorkspaceSetupService.name);
  private readonly baseDir = resolve(homedir(), '.binzbonz', 'projects');
  private readonly binzbonzRoot = resolve(process.cwd(), '..', '..');

  setup(opts: SetupOptions): WorkspacePaths {
    const projectDir = this.resolveProjectDir(opts);
    const isImport = !!opts.isImport;
    let wroteAnything = false;

    // Track whether we created the root dir ourselves — for imports we
    // generally won't, but for a fresh project we always do.
    const rootExisted = existsSync(projectDir);
    if (!rootExisted) {
      mkdirSync(projectDir, { recursive: true });
      wroteAnything = true;
    }

    this.logger.log(
      `${isImport ? 'Importing' : 'Setting up'} workspace at ${projectDir} ` +
        `(root ${rootExisted ? 'existed' : 'created'})`,
    );

    // ── Directories — mkdir -p, no-op if already there ────────────────
    for (const dir of ['memory', 'worktrees', 'skills']) {
      const full = join(projectDir, dir);
      if (!existsSync(full)) {
        mkdirSync(full, { recursive: true });
        wroteAnything = true;
      }
    }

    // ── CLAUDE.md — only write if missing, NEVER overwrite ────────────
    const claudeMdDest = join(projectDir, 'CLAUDE.md');
    if (!existsSync(claudeMdDest)) {
      const claudeMdSrc = resolve(this.binzbonzRoot, 'CLAUDE.md');
      if (existsSync(claudeMdSrc)) {
        copyFileSync(claudeMdSrc, claudeMdDest);
      } else {
        writeFileSync(
          claudeMdDest,
          '# Project\n\nRead `skills/developer.md` or `skills/master.md` for your role.\nShared context lives in `memory/`.\n',
        );
      }
      wroteAnything = true;
    }

    // ── binzbonz.md — per-project config overrides ────────────────────
    const binzbonzMdDest = join(projectDir, 'binzbonz.md');
    if (!existsSync(binzbonzMdDest)) {
      const binzbonzMdSrc = resolve(this.binzbonzRoot, 'binzbonz.md');
      if (existsSync(binzbonzMdSrc)) {
        copyFileSync(binzbonzMdSrc, binzbonzMdDest);
      } else {
        writeFileSync(binzbonzMdDest, this.defaultBinzbonzMd());
      }
      wroteAnything = true;
    }

    // ── Skill files — copy each only if missing ───────────────────────
    for (const skill of ['developer.md', 'master.md', 'openapidev.md']) {
      const src = resolve(this.binzbonzRoot, 'skills', skill);
      const dest = join(projectDir, 'skills', skill);
      if (existsSync(src) && !existsSync(dest)) {
        copyFileSync(src, dest);
        wroteAnything = true;
      }
    }

    // ── memory/README.md — only if missing ────────────────────────────
    const memoryReadme = join(projectDir, 'memory', 'README.md');
    if (!existsSync(memoryReadme)) {
      writeFileSync(
        memoryReadme,
        '# Project Memory\n\nShared context and decisions go here. Agents propose updates via `memory_update` comments.\n',
      );
      wroteAnything = true;
    }

    // ── Git — ONLY init if .git missing. For imports, skip entirely if
    //         already a git repo. For fresh projects, init + initial
    //         commit. Never amend an existing repo's state. ───────────
    const gitDir = join(projectDir, '.git');
    if (!existsSync(gitDir)) {
      try {
        execSync('git init -b main', { cwd: projectDir, stdio: 'pipe' });
        execSync('git add -A', { cwd: projectDir, stdio: 'pipe' });
        execSync('git commit -m "Initial Binzbonz setup"', {
          cwd: projectDir,
          stdio: 'pipe',
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'binzbonz',
            GIT_AUTHOR_EMAIL: 'binzbonz@local',
            GIT_COMMITTER_NAME: 'binzbonz',
            GIT_COMMITTER_EMAIL: 'binzbonz@local',
          },
        });
        this.logger.log(`Git repo initialised at ${projectDir}`);
        wroteAnything = true;
      } catch (err) {
        // Git init failed — not fatal. The project is still usable; the
        // user can `git init` manually. Surface the message so it's
        // obvious in logs.
        this.logger.warn(
          `Git init failed at ${projectDir}: ${(err as Error).message}`,
        );
      }
    } else if (isImport) {
      this.logger.log(`Existing .git detected at ${projectDir} — skipped git init`);
    }

    return {
      repo_path: projectDir,
      worktree_path: join(projectDir, 'worktrees'),
      claude_md_path: claudeMdDest,
      wroteAnything,
    };
  }

  /**
   * Cheap pre-flight check for an import path. Returns an error message on
   * failure or null on success. Throws nothing so callers can turn this
   * into whatever HTTP error type they want.
   */
  validateImportPath(inputPath: string): string | null {
    if (!inputPath || typeof inputPath !== 'string') {
      return 'import_path is required';
    }
    if (!inputPath.startsWith('/')) {
      return 'import_path must be an absolute path';
    }
    const abs = resolve(inputPath);
    if (!existsSync(abs)) {
      return `import_path does not exist: ${abs}`;
    }
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch (err) {
      return `cannot stat import_path: ${(err as Error).message}`;
    }
    if (!st.isDirectory()) {
      return 'import_path must be a directory';
    }
    // Writability check — attempt to touch a sentinel file.
    const sentinel = join(abs, `.binzbonz-write-check-${process.pid}`);
    try {
      writeFileSync(sentinel, '');
      // Clean up on success. Any failure here is fine — it's just a probe.
      try {
        execSync(`rm -f ${JSON.stringify(sentinel)}`);
      } catch {
        /* ignore */
      }
    } catch (err) {
      return `import_path is not writable: ${(err as Error).message}`;
    }
    return null;
  }

  private resolveProjectDir(opts: SetupOptions): string {
    if (opts.customPath) return resolve(opts.customPath);
    const slug = opts.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return resolve(this.baseDir, `${slug}-${opts.id.slice(0, 8)}`);
  }

  private defaultBinzbonzMd(): string {
    return `# Binzbonz Project Configuration

Settings for Binzbonz agents working in this project. The runner parses the
fenced \`json\` block below on every wake event — **do not delete it**.

\`\`\`json
{
  "default_branch": "main",
  "task_branch_template": "task/{task_id_short}",
  "auto_merge": true,
  "need_review_by_other_dev": false
}
\`\`\`
`;
  }
}
