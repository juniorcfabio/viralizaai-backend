import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PaymentProviderConfig,
  ProviderKey,
} from './payment-provider-config.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(PaymentProviderConfig)
    private readonly providerRepo: Repository<PaymentProviderConfig>,
  ) {}

  async getAllPaymentConfigs() {
    const providers: ProviderKey[] = [
      'stripe',
      'pagarme',
      'mercadopago',
      'paypal',
      'pix',
      'crypto',
    ];

    const configs = await this.providerRepo.find();

    const byProvider: Record<string, PaymentProviderConfig | null> = {};
    for (const p of providers) {
      byProvider[p] = configs.find((c) => c.provider === p) || null;
    }

    return byProvider;
  }

  async upsertPaymentConfig(
    provider: ProviderKey,
    data: { isActive?: boolean; config?: Record<string, any> },
  ) {
    let existing = await this.providerRepo.findOne({ where: { provider } });

    if (!existing) {
      existing = this.providerRepo.create({
        provider,
        isActive: data.isActive ?? false,
        config: data.config ?? null,
      });
    } else {
      existing.isActive = data.isActive ?? existing.isActive;
      existing.config = data.config ?? existing.config;
    }

    return this.providerRepo.save(existing);
  }
}