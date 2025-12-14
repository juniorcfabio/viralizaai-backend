import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PaymentProviderConfig,
  ProviderKey,
} from './payment-provider-config.entity';
import { AffiliateSettings } from '../affiliates/affiliate-settings.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(PaymentProviderConfig)
    private readonly providerRepo: Repository<PaymentProviderConfig>,
    @InjectRepository(AffiliateSettings)
    private readonly affiliateSettingsRepo: Repository<AffiliateSettings>,
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

  async getAffiliateSettings() {
    const existing = await this.affiliateSettingsRepo.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });

    if (existing.length > 0) {
      return existing[0];
    }

    const created = this.affiliateSettingsRepo.create({
      commissionRatePercent: '20.00',
    });
    return this.affiliateSettingsRepo.save(created);
  }

  async upsertAffiliateSettings(data: { commissionRatePercent?: number }) {
    const current = await this.getAffiliateSettings();

    if (typeof data.commissionRatePercent === 'number') {
      current.commissionRatePercent = data.commissionRatePercent.toFixed(2);
    }

    return this.affiliateSettingsRepo.save(current);
  }
}