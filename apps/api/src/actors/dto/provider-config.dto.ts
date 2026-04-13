import { IsOptional, IsString, IsUrl } from 'class-validator';

export class ProviderConfigDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  base_url?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  api_key?: string;
}
