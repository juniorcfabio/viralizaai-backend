import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentTransaction } from '../payments/payment-transaction.entity';

export type AffiliateCommissionStatus = 'pending' | 'paid';

@Entity({ name: 'affiliate_commissions' })
@Unique('UQ_affiliate_commission_transaction_id', ['transactionId'])
export class AffiliateCommission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Código do afiliado (ex.: viral_xxx). Mantemos como string para
  // não depender de uma tabela de usuários no backend neste momento.
  @Column({ name: 'affiliate_code', type: 'varchar' })
  affiliateCode: string;

  // Opcional: id do usuário indicado (vindo do frontend), se disponível
  @Column({ name: 'referred_user_id', type: 'varchar', nullable: true })
  referredUserId: string | null;

  @ManyToOne(() => PaymentTransaction, { nullable: false })
  @JoinColumn({ name: 'transaction_id' })
  transaction: PaymentTransaction;

  @Column({ name: 'transaction_id' })
  transactionId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ length: 3 })
  currency: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: AffiliateCommissionStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
