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
}
