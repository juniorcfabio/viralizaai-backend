   import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import Stripe from 'stripe';

import {
  PaymentProvider,
  PaymentTransaction,
} from './payment-transaction.entity';
import {
  PaymentProviderConfig,
  ProviderKey,
} from '../admin/payment-provider-config.entity';
import { AffiliateCommission } from '../affiliates/affiliate-commission.entity';
import { AffiliateSettings } from '../affiliates/affiliate-settings.entity';

interface CheckoutRequestDto {
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  itemType: 'plan' | 'addon';
  itemId: string;
  amount: number; // em unidades normais, ex: 100.00
  currency: string; // ex: 'BRL'
  provider: PaymentProvider; // por enquanto usaremos 'stripe'
  successUrl: string;
  cancelUrl: string;
  // Dados opcionais para programa de afiliados
  referralCode?: string | null;
  referredUserId?: string | null;
}

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly txRepo: Repository<PaymentTransaction>,

    @InjectRepository(PaymentProviderConfig)
    private readonly providerRepo: Repository<PaymentProviderConfig>,
    @InjectRepository(AffiliateCommission)
    private readonly affiliateRepo: Repository<AffiliateCommission>,
    @InjectRepository(AffiliateSettings)
    private readonly affiliateSettingsRepo: Repository<AffiliateSettings>,
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

    if (dto.currency?.toUpperCase() === 'BRL' && amountInCents < 50) {
      throw new BadRequestException(
        "O valor mínimo para checkout na Stripe é R$ 0,50 (BRL).",
      );
    }

    let session: any;
    try {
      session = await (stripe.checkout.sessions.create as any)({
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
          userName: dto.userName || undefined,
          userEmail: dto.userEmail || undefined,
          itemType: dto.itemType,
          itemId: dto.itemId,
          referralCode: dto.referralCode || undefined,
          referredUserId: dto.referredUserId || undefined,
        },
      });
    } catch (err: any) {
      const stripeMessage =
        err?.raw?.message ||
        err?.message ||
        'Erro ao criar sessão de checkout na Stripe.';
      throw new BadRequestException(stripeMessage);
    }

    // 6) Atualizar referência do provedor na nossa transação
    savedTx.providerReference = session.id;
    savedTx.rawPayload = {
      checkoutSessionId: session.id,
      checkoutSessionMetadata: session.metadata,
    };

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

      // Gera comissão de afiliado se houver referralCode nos metadados
      await this.createAffiliateCommissionIfApplicable(saved, metadata);

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

    // Mesmo que já esteja paga, ainda podemos tentar criar a comissão
    // (ex.: se o metadata não foi salvo anteriormente). Também evita
    // duplicação com verificação por transactionId.
    const ensureMetadata = async (current: PaymentTransaction) => {
      const raw = (current.rawPayload as any) || {};
      const existing = raw?.checkoutSessionMetadata;
      if (existing && typeof existing === 'object') {
        return existing as Record<string, any>;
      }

      // Se for Stripe e tiver sessionId, tenta recuperar metadata direto do Stripe
      const sessionId =
        raw?.checkoutSessionId || current.providerReference || undefined;
      if (current.provider === 'stripe' && sessionId) {
        try {
          const providerConfig = await this.getProviderConfig('stripe');
          const secretKey = providerConfig.config?.secretKey;
          if (!secretKey) return {};

          const stripe = new Stripe(secretKey);
          const session = await (stripe.checkout.sessions.retrieve as any)(
            sessionId,
          );
          const metadata = session?.metadata || {};

          current.rawPayload = {
            ...(raw || {}),
            checkoutSessionId: sessionId,
            checkoutSessionMetadata: metadata,
          };

          await this.txRepo.save(current);
          return metadata;
        } catch (err) {
          // Se falhar, apenas segue sem metadata
          return {};
        }
      }

      return {};
    };

    if (tx.status !== 'paid') {
      tx.status = 'paid';
      tx.rawPayload = {
        ...(tx.rawPayload || {}),
        manualConfirm: true,
      };
    }

    const saved = await this.txRepo.save(tx);

    const metadata = await ensureMetadata(saved);
    await this.createAffiliateCommissionIfApplicable(saved, metadata);

    return saved;
  }

  /**
   * Cria um registro de comissão de afiliado, caso exista um
   * código de afiliado nos metadados da transação.
   *
   * Espera encontrar `referralCode` nos metadados recebidos
   * (enviados pelo frontend ao iniciar o checkout).
   */
  private async createAffiliateCommissionIfApplicable(
    tx: PaymentTransaction,
    metadata: Record<string, any>,
  ) {
    const referralCode = (metadata as any)?.referralCode as
      | string
      | undefined;

    if (!referralCode) {
      return;
    }

    // Evita duplicar comissão para a mesma transação
    const existing = await this.affiliateRepo.findOne({
      where: { transactionId: tx.id },
    });
    if (existing) {
      return;
    }

    let commissionRate = 0.2;

    try {
      const settings = await this.affiliateSettingsRepo.find({
        order: { createdAt: 'ASC' },
        take: 1,
      });

      const rawPercent = settings?.[0]?.commissionRatePercent;
      const percent = typeof rawPercent === 'string' ? Number(rawPercent) : NaN;
      if (!Number.isNaN(percent) && percent > 0) {
        commissionRate = percent / 100;
      }
    } catch {
    }

    const rateFromEnv = process.env.AFFILIATE_COMMISSION_RATE;
    if (rateFromEnv && !Number.isNaN(Number(rateFromEnv))) {
      commissionRate = Number(rateFromEnv) / 100;
    }

    if (!commissionRate || commissionRate <= 0) {
      return;
    }

    const txAmount = typeof tx.amount === 'string' ? Number(tx.amount) : 0;
    if (!txAmount || Number.isNaN(txAmount)) {
      return;
    }

    const commissionValue = txAmount * commissionRate;

    const referredUserIdFromMetadata =
      (metadata as any)?.referredUserId || (metadata as any)?.userId || null;

    const referredUserNameFromMetadata =
      (metadata as any)?.referredUserName || (metadata as any)?.userName || null;

    const referredUserEmailFromMetadata =
      (metadata as any)?.referredUserEmail || (metadata as any)?.userEmail || null;

    const commission = this.affiliateRepo.create({
      affiliateCode: referralCode,
      referredUserId: referredUserIdFromMetadata,
      transactionId: tx.id,
      amount: commissionValue.toFixed(2),
      currency: tx.currency,
      status: 'pending',
      metadata: {
        itemType: tx.itemType,
        itemId: tx.itemId,
        referredUserName: referredUserNameFromMetadata,
        referredUserEmail: referredUserEmailFromMetadata,
      },
    });

    try {
      await this.affiliateRepo.save(commission);
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const detail = (err?.detail as string | undefined) || '';

      // Idempotência: evita quebrar o fluxo se duas confirmações ocorrerem
      // em paralelo e tentarem criar a mesma comissão.
      if (code === '23505' && detail.includes('transaction_id')) {
        return;
      }

      throw err;
    }
  }
}