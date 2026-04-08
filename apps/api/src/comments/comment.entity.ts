import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Task } from '../tasks/task.entity.js';
import { Actor } from '../actors/actor.entity.js';

@Entity()
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task!: Task;

  @Column({ name: 'task_id', type: 'uuid' })
  task_id!: string;

  @ManyToOne(() => Actor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_id' })
  actor!: Actor;

  @Column({ name: 'actor_id', type: 'uuid' })
  actor_id!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'text', default: 'update' })
  comment_type!: string; // update | block | question | review_request | handoff | memory_update

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
