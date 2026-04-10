import { Injectable, Logger } from '@nestjs/common';
import { mkdirSync, writeFileSync, existsSync, copyFileSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

export interface WorkspacePaths {
  repo_path: string;
  worktree_path: string;
  claude_md_path: string;
}

@Injectable()
export class WorkspaceSetupService {
  private readonly logger = new Logger(WorkspaceSetupService.name);
  private readonly baseDir = resolve(homedir(), '.binzbonz', 'projects');
  private readonly binzbonzRoot = resolve(process.cwd(), '..', '..');

  setup(projectName: string, projectId: string, customPath?: string): WorkspacePaths {
    let projectDir: string;
    if (customPath) {
      projectDir = resolve(customPath);
    } else {
      const slug = projectName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      projectDir = resolve(this.baseDir, `${slug}-${projectId.slice(0, 8)}`);
    }

    this.logger.log(`Setting up workspace at ${projectDir}`);

    // Create directory structure
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, 'memory'), { recursive: true });
    mkdirSync(join(projectDir, 'worktrees'), { recursive: true });
    mkdirSync(join(projectDir, 'skills'), { recursive: true });

    // Copy CLAUDE.md
    const claudeMdSrc = resolve(this.binzbonzRoot, 'CLAUDE.md');
    const claudeMdDest = join(projectDir, 'CLAUDE.md');
    if (existsSync(claudeMdSrc)) {
      copyFileSync(claudeMdSrc, claudeMdDest);
    } else {
      writeFileSync(
        claudeMdDest,
        '# Project\n\nRead `skills/developer.md` or `skills/ctbaceo.md` for your role.\nShared context lives in `memory/`.\n',
      );
    }

    // Copy skill files
    for (const skill of ['developer.md', 'ctbaceo.md']) {
      const src = resolve(this.binzbonzRoot, 'skills', skill);
      const dest = join(projectDir, 'skills', skill);
      if (existsSync(src)) {
        copyFileSync(src, dest);
      }
    }

    // Create initial memory file
    writeFileSync(
      join(projectDir, 'memory', 'README.md'),
      '# Project Memory\n\nShared context and decisions go here. Agents propose updates via `memory_update` comments.\n',
    );

    // Git init + initial commit
    if (!existsSync(join(projectDir, '.git'))) {
      execSync('git init -b main', { cwd: projectDir, stdio: 'pipe' });
      execSync('git add -A', { cwd: projectDir, stdio: 'pipe' });
      execSync('git commit -m "Initial project setup"', {
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
    }

    return {
      repo_path: projectDir,
      worktree_path: join(projectDir, 'worktrees'),
      claude_md_path: claudeMdDest,
    };
  }
}
