import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity.js';
import { Actor } from '../actors/actor.entity.js';

@Entity()
export class MemoryFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'project_id', type: 'uuid' })
  project_id!: string;

  @Column({ type: 'text' })
  file_path!: string;

  @Column({ type: 'timestamptz' })
  last_updated_at!: Date;

  @ManyToOne(() => Actor, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'last_updated_by' })
  last_updated_by_actor!: Actor | null;

  @Column({ name: 'last_updated_by', type: 'uuid', nullable: true })
  last_updated_by!: string | null;

  @Column({ type: 'text', nullable: true })
  git_commit!: string | null;
}
