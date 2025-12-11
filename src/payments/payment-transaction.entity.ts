import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentProvider =
  | 'stripe'
  | 'pagarme'
  | 'mercadopago'
  | 'paypal'
  | 'pix'
  | 'boleto'
  | 'crypto'
  | 'deposit';

export type PaymentStatus = 'pending' | 'paid' | 'failed';

@Entity({ name: 'payment_transactions' })
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'item_type' })
  itemType: 'plan' | 'addon';

  @Column({ name: 'item_id' })
  itemId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ length: 3 })
  currency: string;

  @Column({ type: 'varchar' })
  provider: PaymentProvider;

  @Column({ type: 'varchar', default: 'pending' })
  status: PaymentStatus;

  @Column({
    type: 'varchar',
    name: 'provider_reference',
    nullable: true,
  })
  providerReference: string | null;

  @Column({
    name: 'raw_payload',
    type: 'jsonb',
    nullable: true,
  })
  rawPayload: any | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}