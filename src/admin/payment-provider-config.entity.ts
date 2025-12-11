import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ProviderKey =
  | 'stripe'
  | 'pagarme'
  | 'mercadopago'
  | 'paypal'
  | 'pix'
  | 'crypto';

@Entity({ name: 'payment_provider_configs' })
export class PaymentProviderConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  provider: ProviderKey;

  @Column({ type: 'boolean', default: false })
  isActive: boolean;

  // JSON com as chaves/params necessários (guardados só no backend)
  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, any> | null;
}