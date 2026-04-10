import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { Actor } from './actor.entity.js';

@Entity()
@Unique(['agent_id', 'account_email'])
export class AgentSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Actor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent!: Actor;

  @Column({ name: 'agent_id', type: 'uuid' })
  agent_id!: string;

  @Column({ type: 'text' })
  account_email!: string;

  @Column({ type: 'text', nullable: true })
  session_id!: string | null;

  @Column({ type: 'int', default: 0 })
  last_token_count!: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_active_at!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
