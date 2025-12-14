import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'affiliate_settings' })
export class AffiliateSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'commission_rate_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 20,
  })
  commissionRatePercent: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
