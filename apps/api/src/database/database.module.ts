import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmbeddedPostgresService } from './embedded-postgres.service.js';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: async (epService: EmbeddedPostgresService) => {
        const url = await epService.boot();
        return {
          type: 'postgres' as const,
          url,
          autoLoadEntities: true,
          synchronize: true,
        };
      },
      inject: [EmbeddedPostgresService],
    }),
  ],
  providers: [EmbeddedPostgresService],
  exports: [EmbeddedPostgresService],
})
export class DatabaseModule {}
