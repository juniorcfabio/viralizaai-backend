import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import {
  PaymentTransaction,
  PaymentProvider,
} from './payment-transaction.entity';
import {
  PaymentProviderConfig,
  ProviderKey,
} from '../admin/payment-provider-config.entity';

interface CheckoutRequestDto {
  userId: string;
  itemType: 'plan' | 'addon';
  itemId: string;
  amount: number; // em unidades normais, ex: 100.00
  currency: string; // ex: 'BRL'
  provider: PaymentProvider; // por enquanto usaremos 'stripe'
  successUrl: string;
  cancelUrl: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly txRepo: Repository<PaymentTransaction>,

    @InjectRepository(PaymentProviderConfig)
    private readonly providerRepo: Repository<PaymentProviderConfig>,
  ) {}

  getTestMessage() {
    return { ok: true, message: 'Payments API online' };
  }

  // ------- Fluxo de testes que já existia -------

  async createTestTransaction(userId: string, provider: PaymentProvider) {
    const tx = this.txRepo.create({
      userId,
      itemType: 'plan',
      itemId: 'PLANO_TESTE',
      amount: '100.00',
      currency: 'BRL',
      provider,
      status: 'pending',
      providerReference: null,
      rawPayload: null,
    });

    const saved = await this.txRepo.save(tx);
    return saved;
  }

  async listTransactions() {
    return this.txRepo.find({
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  // ------- Fluxo real: checkout com Stripe (modo teste) -------

  private async getProviderConfig(provider: ProviderKey) {
    const cfg = await this.providerRepo.findOne({
      where: { provider },
    });

    if (!cfg || !cfg.isActive || !cfg.config) {
      throw new BadRequestException(
        `Configurações do provedor ${provider} não encontradas ou inativas.`,
      );
    }

    return cfg;
  }

  async createStripeCheckout(dto: CheckoutRequestDto) {
    // 1) Garantir que o provider pedido é stripe
    if (dto.provider !== 'stripe') {
      throw new BadRequestException(
        'Este endpoint de checkout está configurado apenas para Stripe.',
      );
    }

    // 2) Buscar config da Stripe no banco (salva pela tela AdminPayments)
    const providerConfig = await this.getProviderConfig('stripe');

    const secretKey = providerConfig.config?.secretKey;
    const publicKey = providerConfig.config?.publicKey;

    if (!secretKey || !publicKey) {
      throw new BadRequestException(
        'Chaves da Stripe não configuradas corretamente.',
      );
    }

    // 3) Instanciar cliente Stripe (modo teste, usando secretKey)
    const stripe = new Stripe(secretKey);

    // 4) Criar transação pendente no nosso banco
    const tx = this.txRepo.create({
      userId: dto.userId,
      itemType: dto.itemType,
      itemId: dto.itemId,
      amount: dto.amount.toFixed(2),
      currency: dto.currency.toUpperCase(),
      provider: 'stripe',
      status: 'pending',
      providerReference: null,
      rawPayload: null,
    });
    const savedTx = await this.txRepo.save(tx);

    // 5) Criar sessão de checkout na Stripe
    //    amount em centavos (ex.: 100.00 -> 10000)
    const amountInCents = Math.round(dto.amount * 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: dto.currency.toLowerCase(),
            unit_amount: amountInCents,
            product_data: {
              name: dto.itemId,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${dto.successUrl}?txId=${savedTx.id}`,
      cancel_url: `${dto.cancelUrl}?txId=${savedTx.id}`,
      metadata: {
        txId: savedTx.id,
        userId: dto.userId,
        itemType: dto.itemType,
        itemId: dto.itemId,
      },
    });

    // 6) Atualizar referência do provedor na nossa transação
    savedTx.providerReference = session.id;
    savedTx.rawPayload = { checkoutSessionId: session.id };
    await this.txRepo.save(savedTx);

    // 7) Retornar URL do checkout para o frontend redirecionar
    return {
      checkoutUrl: session.url,
      transactionId: savedTx.id,
      provider: 'stripe',
    };
  }

  // ------- Tratamento de Webhook Stripe -------

  /**
   * Recebe o payload enviado pela Stripe no webhook
   * e atualiza a transação para "paid" quando o
   * evento for "checkout.session.completed".
   *
   * IMPORTANTE: em produção devemos validar a assinatura
   * do webhook com o segredo da Stripe. Aqui, em modo teste,
   * vamos confiar no payload só para fechar o ciclo.
   */
  async handleStripeWebhookEvent(payload: any) {
    try {
      const eventType = payload?.type;

      if (eventType !== 'checkout.session.completed') {
        // Por enquanto só nos importamos com esse tipo
        return {
          ignored: true,
          reason: 'unsupported_event_type',
          type: eventType,
        };
      }

      const session = payload.data?.object;
      if (!session) {
        return { ignored: true, reason: 'missing_session_object' };
      }

      const metadata = session.metadata || {};
      const txId = metadata.txId as string | undefined;

      if (!txId) {
        return { ignored: true, reason: 'missing_txId_in_metadata' };
      }

      const tx = await this.txRepo.findOne({ where: { id: txId } });
      if (!tx) {
        return { ignored: true, reason: 'transaction_not_found', txId };
      }

      // Atualiza status para "paid" e guarda o payload bruto
      tx.status = 'paid';
      tx.rawPayload = {
        ...(tx.rawPayload || {}),
        stripeWebhook: payload,
      };

      const saved = await this.txRepo.save(tx);

      return {
        processed: true,
        txId: saved.id,
        status: saved.status,
      };
    } catch (err) {
      console.error('Erro ao processar webhook Stripe:', err);
      throw err;
    }
  }

  // ------- Confirmação manual de pagamento (sem webhook) -------

  /**
   * Marca a transação como "paid" quando o frontend
   * retorna do checkout com o txId.
   *
   * Em modo de teste/local, usamos isso para fechar o ciclo
   * sem precisar configurar webhooks/Stripe CLI.
   */
  async confirmTransaction(txId: string) {
    if (!txId) {
      throw new BadRequestException('txId é obrigatório para confirmação.');
    }

    const tx = await this.txRepo.findOne({ where: { id: txId } });
    if (!tx) {
      throw new BadRequestException(
        'Transação não encontrada para o txId informado.',
      );
    }

    // Se já estiver paga, apenas retorna
    if (tx.status === 'paid') {
      return tx;
    }

    tx.status = 'paid';
    tx.rawPayload = {
      ...(tx.rawPayload || {}),
      manualConfirm: true,
    };

    const saved = await this.txRepo.save(tx);
    return saved;
  }
}