import { IsString, IsOptional } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name!: string;

  @IsString()
  brief!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  repo_path?: string;

  @IsOptional()
  @IsString()
  worktree_path?: string;

  @IsOptional()
  @IsString()
  claude_md_path?: string;

  /**
   * Absolute path to an existing directory to import as this project's
   * workspace. When set, the service runs idempotent scaffolding at that
   * path (creating `binzbonz.md`, `skills/`, `memory/`, etc. only if
   * missing) and will NOT touch an existing `.git` or overwrite existing
   * files. Mutually exclusive with `repo_path`.
   */
  @IsOptional()
  @IsString()
  import_path?: string;
}
