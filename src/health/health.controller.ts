import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'viralizaai-backend',
      version: '1.0.0'
    };
  }

  @Get()
  getRoot() {
    return {
      message: 'Viraliza.ai Backend API',
      status: 'running',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        payments: '/payments',
        affiliates: '/affiliates',
        admin: '/admin'
      }
    };
  }
}
