import { IsString, IsIn, IsOptional, IsUrl } from 'class-validator';

export class CreateActorDto {
  @IsString()
  name!: string;

  @IsIn(['human', 'agent'])
  type!: string;

  @IsOptional()
  @IsIn(['developer', 'ctbaceo', 'openapidev', 'openapicoor'])
  role?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;

  // Provider config — required when role is openapidev / openapicoor.
  // Validation enforced in the service layer (cross-field check).
  @IsOptional()
  @IsUrl({ require_tld: false })
  provider_base_url?: string;

  @IsOptional()
  @IsString()
  provider_model?: string;

  @IsOptional()
  @IsString()
  provider_api_key?: string;
}
