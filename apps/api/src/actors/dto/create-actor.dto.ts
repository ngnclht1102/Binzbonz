import { IsString, IsIn, IsOptional } from 'class-validator';

export class CreateActorDto {
  @IsString()
  name!: string;

  @IsIn(['human', 'agent'])
  type!: string;

  @IsOptional()
  @IsIn(['developer', 'ctbaceo'])
  role?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;
}
