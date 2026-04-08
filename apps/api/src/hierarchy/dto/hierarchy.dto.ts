import { IsString, IsOptional } from 'class-validator';

export class CreateMvpDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() status?: string;
}

export class UpdateMvpDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() status?: string;
}

export class CreateSprintDto {
  @IsString() title!: string;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsString() start_date?: string;
  @IsOptional() @IsString() end_date?: string;
  @IsOptional() @IsString() status?: string;
}

export class UpdateSprintDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsString() start_date?: string;
  @IsOptional() @IsString() end_date?: string;
  @IsOptional() @IsString() status?: string;
}

export class CreateEpicDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
}

export class UpdateEpicDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
}

export class CreateFeatureDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() acceptance_criteria?: string;
}

export class UpdateFeatureDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() acceptance_criteria?: string;
}
