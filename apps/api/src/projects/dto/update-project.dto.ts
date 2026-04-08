import { IsString, IsIn, IsOptional } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  brief?: string;

  @IsOptional()
  @IsIn(['analysing', 'paused', 'active', 'completed'])
  status?: string;

  @IsOptional()
  @IsString()
  repo_path?: string;

  @IsOptional()
  @IsString()
  worktree_path?: string;

  @IsOptional()
  @IsString()
  claude_md_path?: string;
}
