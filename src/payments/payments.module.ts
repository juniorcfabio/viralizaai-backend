import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentTransaction } from './payment-transaction.entity';
import { PaymentProviderConfig } from '../admin/payment-provider-config.entity';
import { AffiliateCommission } from '../affiliates/affiliate-commission.entity';
import { AffiliateSettings } from '../affiliates/affiliate-settings.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentTransaction,
      PaymentProviderConfig,
      AffiliateCommission,
      AffiliateSettings,
    ]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}