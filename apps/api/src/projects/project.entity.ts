import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  brief!: string | null;

  @Column({ type: 'text', nullable: true })
  repo_path!: string | null;

  @Column({ type: 'text', default: 'main' })
  main_branch!: string;

  @Column({ type: 'text', nullable: true })
  worktree_path!: string | null;

  @Column({ type: 'text', nullable: true })
  claude_md_path!: string | null;

  @Column({ type: 'text', default: 'analysing' })
  status!: string; // analysing | paused | active | completed

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
