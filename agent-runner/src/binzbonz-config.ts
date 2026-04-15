/**
 * Parser for the per-project `binzbonz.md` config file. The file lives at
 * `<repo_path>/binzbonz.md` and wraps a JSON block that the runner reads
 * before every wake event to decide project-specific behavior (branch
 * naming, merge/review policy, peer-review requirement).
 *
 * Shape of the fenced block:
 *
 *     ```json
 *     {
 *       "need_review_by_other_dev": false,
 *       "default_branch_name": "task/{task_id_short}",
 *       "dont_merge_after_done": false
 *     }
 *     ```
 *
 * Missing file, missing block, malformed JSON, or unknown keys all fall
 * back to defaults — we never want a stray typo to halt an agent.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { warn } from './logger.js';

export interface BinzbonzConfig {
  /** Require peer review by another developer before marking done. */
  need_review_by_other_dev: boolean;
  /**
   * The integration branch this project merges into (or targets PRs at).
   * Usually `"main"`, but projects like sway use `"dev"` instead. The
   * skill file tells the agent to use THIS value instead of a hardcoded
   * `main` when finalizing work.
   */
  default_branch: string;
  /** Template for task branch names. Variables: {task_id}, {task_id_short}, {title_slug}. */
  task_branch_template: string;
  /**
   * Whether the agent may merge its task branch into `default_branch` on
   * its own. When `false`, the agent still pushes the branch to origin
   * but sets the task to `review_request` and lets a human merge it.
   * Default `true` preserves the previous "agent merges itself" behavior.
   */
  auto_merge: boolean;
}

export const DEFAULT_CONFIG: BinzbonzConfig = {
  need_review_by_other_dev: false,
  default_branch: 'main',
  task_branch_template: 'task/{task_id_short}',
  auto_merge: true,
};

// Match a fenced ```json ... ``` block. Non-greedy so multiple fences
// can coexist in the markdown file — we pick the first json one.
const JSON_FENCE_RE = /```json\s*\n([\s\S]*?)\n```/i;

/**
 * Read and parse `<repoPath>/binzbonz.md`. Always returns a resolved
 * config — never throws. Unknown keys in the file are silently dropped.
 */
export function loadBinzbonzConfig(repoPath: string | null | undefined): BinzbonzConfig {
  if (!repoPath) return { ...DEFAULT_CONFIG };
  const filePath = resolve(repoPath, 'binzbonz.md');
  if (!existsSync(filePath)) return { ...DEFAULT_CONFIG };

  let text: string;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch (err) {
    warn('binzbonz-config', `Failed to read ${filePath}: ${(err as Error).message}`);
    return { ...DEFAULT_CONFIG };
  }

  const match = JSON_FENCE_RE.exec(text);
  if (!match) return { ...DEFAULT_CONFIG };

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch (err) {
    warn(
      'binzbonz-config',
      `Malformed JSON in ${filePath}: ${(err as Error).message} — using defaults`,
    );
    return { ...DEFAULT_CONFIG };
  }

  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CONFIG };
  const obj = parsed as Record<string, unknown>;

  return {
    need_review_by_other_dev:
      typeof obj.need_review_by_other_dev === 'boolean'
        ? obj.need_review_by_other_dev
        : DEFAULT_CONFIG.need_review_by_other_dev,
    default_branch:
      typeof obj.default_branch === 'string' && obj.default_branch.trim()
        ? obj.default_branch.trim()
        : DEFAULT_CONFIG.default_branch,
    task_branch_template:
      typeof obj.task_branch_template === 'string' && obj.task_branch_template.trim()
        ? obj.task_branch_template.trim()
        : DEFAULT_CONFIG.task_branch_template,
    auto_merge:
      typeof obj.auto_merge === 'boolean'
        ? obj.auto_merge
        : DEFAULT_CONFIG.auto_merge,
  };
}

/**
 * Convert a task title into a kebab-case slug suitable for a branch name.
 * Strips non-alphanumerics, collapses runs of dashes, caps at 40 chars.
 */
function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'task'
  );
}

/**
 * Resolve a branch-name template against a task. Unknown variables are
 * left as-is so the agent can spot typos in its own config. Falls back
 * to "task/<task_id_short>" if the template renders to an empty string.
 */
export function resolveBranchName(
  template: string,
  task: { id: string; title?: string | null },
): string {
  const shortId = task.id.slice(0, 8);
  const titleSlug = slugifyTitle(task.title ?? '');
  const resolved = template
    .replace(/\{task_id_short\}/g, shortId)
    .replace(/\{task_id\}/g, task.id)
    .replace(/\{title_slug\}/g, titleSlug)
    .trim();
  return resolved || `task/${shortId}`;
}
