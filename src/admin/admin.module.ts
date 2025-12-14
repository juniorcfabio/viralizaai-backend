import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PaymentProviderConfig } from './payment-provider-config.entity';
import { AffiliateSettings } from '../affiliates/affiliate-settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentProviderConfig, AffiliateSettings])],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}