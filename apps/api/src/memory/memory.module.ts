import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemoryFile } from './memory-file.entity.js';
import { MemoryController } from './memory.controller.js';
import { MemoryService } from './memory.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([MemoryFile])],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService, TypeOrmModule],
})
export class MemoryModule {}
