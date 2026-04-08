import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Feature } from '../hierarchy/feature.entity.js';
import { Actor } from '../actors/actor.entity.js';

@Entity()
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Feature, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'feature_id' })
  feature!: Feature;

  @Column({ name: 'feature_id', type: 'uuid' })
  feature_id!: string;

  @ManyToOne(() => Task, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_task_id' })
  parent_task!: Task | null;

  @Column({ name: 'parent_task_id', type: 'uuid', nullable: true })
  parent_task_id!: string | null;

  @OneToMany(() => Task, (task) => task.parent_task)
  subtasks!: Task[];

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', default: 'backlog' })
  status!: string; // backlog | assigned | in_progress | blocked | review_request | done

  @ManyToOne(() => Actor, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_agent_id' })
  assigned_agent!: Actor | null;

  @Column({ name: 'assigned_agent_id', type: 'uuid', nullable: true })
  assigned_agent_id!: string | null;

  @Column({ type: 'text', nullable: true })
  branch_name!: string | null;

  @Column({ type: 'text', nullable: true })
  worktree_path!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  worktree_created_at!: Date | null;

  @ManyToOne(() => Actor, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  created_by_actor!: Actor | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  created_by!: string | null;

  @Column({ type: 'int', default: 0 })
  priority!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
