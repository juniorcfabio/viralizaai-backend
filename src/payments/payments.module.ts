import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentTransaction } from './payment-transaction.entity';
import { PaymentProviderConfig } from '../admin/payment-provider-config.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentTransaction, PaymentProviderConfig])],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}