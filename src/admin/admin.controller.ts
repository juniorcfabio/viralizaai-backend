import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { AdminService } from './admin.service';
import { ProviderKey } from './payment-provider-config.entity';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // GET /admin/payment-configs
  @Get('payment-configs')
  getPaymentConfigs() {
    return this.adminService.getAllPaymentConfigs();
  }

  // PUT /admin/payment-configs/:provider
  @Put('payment-configs/:provider')
  updatePaymentConfig(
    @Param('provider') providerParam: string,
    @Body()
    body: {
      isActive?: boolean;
      config?: Record<string, any>;
    },
  ) {
    const provider = providerParam as ProviderKey;
    return this.adminService.upsertPaymentConfig(provider, body);
  }
}