import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Epic } from './epic.entity.js';

@Entity()
export class Feature {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Epic, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'epic_id' })
  epic!: Epic;

  @Column({ name: 'epic_id', type: 'uuid' })
  epic_id!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  acceptance_criteria!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
