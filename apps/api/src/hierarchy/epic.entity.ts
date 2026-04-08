import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Sprint } from './sprint.entity.js';

@Entity()
export class Epic {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Sprint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sprint_id' })
  sprint!: Sprint;

  @Column({ name: 'sprint_id', type: 'uuid' })
  sprint_id!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
