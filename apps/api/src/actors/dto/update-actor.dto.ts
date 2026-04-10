import { IsString, IsIn, IsOptional } from 'class-validator';

export class UpdateActorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['idle', 'working', 'compacting'])
  status?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;
}
