import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AffiliateCommission } from './affiliate-commission.entity';
import { AffiliateSettings } from './affiliate-settings.entity';
import { AffiliatesController } from './affiliates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AffiliateCommission, AffiliateSettings])],
  controllers: [AffiliatesController],
})
export class AffiliatesModule {}
