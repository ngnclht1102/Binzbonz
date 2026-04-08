import { IsString, IsUUID, IsIn, IsOptional } from 'class-validator';

export class CreateCommentDto {
  @IsUUID()
  actor_id!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsIn(['update', 'block', 'question', 'review_request', 'handoff', 'memory_update'])
  comment_type?: string;
}
