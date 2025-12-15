import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentProvider } from './payment-transaction.entity';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('test')
  getTest() {
    return this.paymentsService.getTestMessage();
  }

  // Rota de teste que já existia
  @Get('create-test')
  createTest(
    @Query('userId') userId?: string,
    @Query('provider') provider?: string,
  ) {
    const safeUserId = userId || 'USER_TESTE';
    const safeProvider = (provider || 'stripe') as PaymentProvider;
    return this.paymentsService.createTestTransaction(safeUserId, safeProvider);
  }

  @Get('list')
  list() {
    return this.paymentsService.listTransactions();
  }

  // ------- NOVO: Checkout via Stripe (modo teste) -------
  // POST /payments/checkout
  //
  // Exemplo de body:
  // {
  //   "userId": "USER_ID",
  //   "itemType": "plan",
  //   "itemId": "Plano Mensal",
  //   "amount": 100.00,
  //   "currency": "BRL",
  //   "provider": "stripe",
  //   "successUrl": "http://localhost:5174/ViralizaAi/#/dashboard/billing",
  //   "cancelUrl": "http://localhost:5174/ViralizaAi/#/dashboard/billing"
  // }
  @Post('checkout')
  createCheckout(@Body() body: any) {
    return this.paymentsService.createStripeCheckout(body);
  }

  // Confirmação manual: POST /payments/confirm { txId }
  @Post('confirm')
  confirm(@Body() body: { txId: string }) {
    return this.paymentsService.confirmTransaction(body.txId);
  }

  // ------- Admin: criar comissão manualmente (correção retroativa) -------
  // POST /payments/admin/affiliate-commission
  @Post('admin/affiliate-commission')
  createAffiliateCommissionManually(
    @Body()
    body: {
      txId: string;
      affiliateCode: string;
      referredUserId?: string | null;
      referredUserName?: string | null;
      referredUserEmail?: string | null;
    },
  ) {
    return this.paymentsService.createAffiliateCommissionManually(body);
  }

  // ------- WEBHOOK Stripe -------
  @Post('webhook')
  handleStripeWebhookCompat(@Body() payload: any) {
    return this.paymentsService.handleStripeWebhookEvent(payload);
  }

  @Post('webhooks/stripe')
  handleStripeWebhook(@Body() payload: any) {
    // Agora delega para o service, que atualiza a transação
    return this.paymentsService.handleStripeWebhookEvent(payload);
  }
}