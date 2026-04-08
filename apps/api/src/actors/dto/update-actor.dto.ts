import { IsString, IsIn, IsOptional, IsInt } from 'class-validator';

export class UpdateActorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['idle', 'working', 'compacting'])
  status?: string;

  @IsOptional()
  @IsString()
  session_id?: string;

  @IsOptional()
  @IsInt()
  last_token_count?: number;

  @IsOptional()
  @IsString()
  avatar_url?: string;
}
