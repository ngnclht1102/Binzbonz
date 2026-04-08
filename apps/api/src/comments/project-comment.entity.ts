import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity.js';
import { Actor } from '../actors/actor.entity.js';

@Entity()
export class ProjectComment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'project_id', type: 'uuid' })
  project_id!: string;

  @ManyToOne(() => Actor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_id' })
  actor!: Actor;

  @Column({ name: 'actor_id', type: 'uuid' })
  actor_id!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'text', default: 'update' })
  comment_type!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
