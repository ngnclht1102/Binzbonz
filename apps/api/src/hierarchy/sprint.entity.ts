import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Mvp } from './mvp.entity.js';

@Entity()
export class Sprint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Mvp, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mvp_id' })
  mvp!: Mvp;

  @Column({ name: 'mvp_id', type: 'uuid' })
  mvp_id!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  goal!: string | null;

  @Column({ type: 'date', nullable: true })
  start_date!: string | null;

  @Column({ type: 'date', nullable: true })
  end_date!: string | null;

  @Column({ type: 'text', default: 'active' })
  status!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
