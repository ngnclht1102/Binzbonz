import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Actor } from '../actors/actor.entity.js';
import { Project } from '../projects/project.entity.js';
import { Comment } from '../comments/comment.entity.js';

@Entity()
export class WakeEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Actor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent!: Actor;

  @Column({ name: 'agent_id', type: 'uuid' })
  agent_id!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'project_id', type: 'uuid' })
  project_id!: string;

  @Column({ type: 'text' })
  triggered_by!: string; // mention | assignment | project_created | project_resumed

  @ManyToOne(() => Comment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'comment_id' })
  comment!: Comment | null;

  @Column({ name: 'comment_id', type: 'uuid', nullable: true })
  comment_id!: string | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  task_id!: string | null;

  @Column({ type: 'text', default: 'pending' })
  status!: string; // pending | processing | done | failed | skipped

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
