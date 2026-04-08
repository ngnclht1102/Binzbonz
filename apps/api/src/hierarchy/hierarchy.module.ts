import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mvp } from './mvp.entity.js';
import { Sprint } from './sprint.entity.js';
import { Epic } from './epic.entity.js';
import { Feature } from './feature.entity.js';
import { HierarchyController } from './hierarchy.controller.js';
import { HierarchyService } from './hierarchy.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Mvp, Sprint, Epic, Feature])],
  controllers: [HierarchyController],
  providers: [HierarchyService],
  exports: [HierarchyService, TypeOrmModule],
})
export class HierarchyModule {}
