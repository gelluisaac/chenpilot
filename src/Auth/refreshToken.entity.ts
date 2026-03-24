import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./user.entity";

@Entity()
export class RefreshToken {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  @Index()
  token!: string;

  @Column({ type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "timestamp" })
  @Index()
  expiresAt!: Date;

  @Column({ type: "boolean", default: false })
  @Index()
  isRevoked!: boolean;

  @Column({ type: "varchar", nullable: true })
  replacedByToken?: string;

  @Column({ type: "varchar", nullable: true })
  revokedReason?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
