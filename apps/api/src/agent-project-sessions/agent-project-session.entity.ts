import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { Actor } from '../actors/actor.entity.js';
import { Project } from '../projects/project.entity.js';

/**
 * One row per (agent, project) pair. Holds the Claude session_id used by the
 * runner when spawning that agent for that project, plus token usage and
 * activity tracking. Cascade deletes from both sides — drop a project or an
 * agent and the corresponding session rows go away.
 */
@Entity()
@Unique(['agent_id', 'project_id'])
export class AgentProjectSession {
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

  @Column({ type: 'text', nullable: true })
  session_id!: string | null;

  @Column({ type: 'int', default: 0 })
  last_token_count!: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_active_at!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
