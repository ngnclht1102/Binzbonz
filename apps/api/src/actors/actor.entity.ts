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
  role!: string | null; // developer | master | openapidev | openapicoor | null

  @Column({ type: 'text', nullable: true })
  avatar_url!: string | null;

  @Column({ type: 'text', default: 'idle' })
  status!: string; // idle | working | compacting

  // Provider config — only set for openapidev / openapicoor roles. The
  // api_key is stored raw and MUST be stripped from any response or log
  // line via redactActor() before leaving the server.
  @Column({ type: 'text', nullable: true })
  provider_base_url!: string | null;

  @Column({ type: 'text', nullable: true })
  provider_model!: string | null;

  @Column({ type: 'text', nullable: true })
  provider_api_key!: string | null;

  // Heartbeat config — at most ONE actor in the system can have heartbeat
  // enabled at a time (enforced in the service layer).
  @Column({ type: 'boolean', default: false })
  heartbeat_enabled!: boolean;

  @Column({ type: 'int', default: 300 })
  heartbeat_interval_seconds!: number;

  @Column({ type: 'timestamptz', nullable: true })
  heartbeat_last_at!: Date | null;

  // Live output tail — rolling buffer of the agent's stdout while it's
  // working, shown on the project-scoped agent page. Capped to ~128KB; the
  // runner streams chunks in and the actors.service drops from the front
  // when the cap is hit. Cleared atomically when status flips back to idle.
  @Column({ type: 'text', nullable: true })
  live_output!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  live_output_updated_at!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
