import { IsString, IsOptional, IsInt, IsUUID } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  created_by?: string;

  @IsOptional()
  @IsInt()
  priority?: number;
}
