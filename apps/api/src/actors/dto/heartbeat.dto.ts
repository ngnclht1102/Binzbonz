import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class HeartbeatDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsInt()
  @Min(30)
  interval_seconds?: number;
}
