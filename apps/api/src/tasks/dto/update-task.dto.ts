import { IsString, IsOptional, IsIn, IsInt, IsUUID } from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['backlog', 'assigned', 'in_progress', 'blocked', 'review_request', 'done', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsUUID()
  assigned_agent_id?: string;

  @IsOptional()
  @IsInt()
  priority?: number;
}
