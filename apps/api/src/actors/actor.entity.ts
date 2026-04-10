import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class Actor {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'text' })
  type!: string; // human | agent

  @Column({ type: 'text', nullable: true })
  role!: string | null; // developer | ctbaceo | null

  @Column({ type: 'text', nullable: true })
  avatar_url!: string | null;

  @Column({ type: 'text', default: 'idle' })
  status!: string; // idle | working | compacting

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
