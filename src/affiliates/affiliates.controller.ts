import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AffiliateCommission } from './affiliate-commission.entity';

@Controller('affiliates')
export class AffiliatesController {
  constructor(
    @InjectRepository(AffiliateCommission)
    private readonly affiliateRepo: Repository<AffiliateCommission>,
  ) {}

  // -------- Área do próprio afiliado --------

  // Em produção, o affiliateCode viria do usuário logado (token),
  // aqui recebemos via query para simplificar.
  @Get('me/commissions')
  async getMyCommissions(@Query('affiliateCode') affiliateCode?: string) {
    if (!affiliateCode) {
      return { commissions: [], totals: { pending: 0, paid: 0 } };
    }

    const commissions = await this.affiliateRepo.find({
      where: { affiliateCode },
      order: { createdAt: 'DESC' },
    });

    let pending = 0;
    let paid = 0;

    for (const c of commissions) {
      const value = typeof c.amount === 'string' ? Number(c.amount) : 0;
      if (!value || Number.isNaN(value)) continue;
      if (c.status === 'pending') pending += value;
      if (c.status === 'paid') paid += value;
    }

    return {
      commissions,
      totals: {
        pending: Number(pending.toFixed(2)),
        paid: Number(paid.toFixed(2)),
      },
    };
  }

  @Get('me/referred-users')
  async getMyReferredUsers(@Query('affiliateCode') affiliateCode?: string) {
    if (!affiliateCode) {
      return { referredUserIds: [], referredUsers: [] };
    }

    const commissions = await this.affiliateRepo.find({
      where: { affiliateCode },
      order: { createdAt: 'DESC' },
    });

    const validIds = commissions
      .map((c) =>
        c.referredUserId ||
        ((c.metadata as any)?.referredUserId as string | undefined) ||
        ((c.metadata as any)?.userId as string | undefined) ||
        null,
      )
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    const ids = Array.from(new Set(validIds));

    const byUser: Record<
      string,
      {
        referredUserId: string;
        referredUserName: string | null;
        referredUserEmail: string | null;
        firstSeenAt: string;
        lastSeenAt: string;
        hasPlan: boolean;
        hasGrowthEngine: boolean;
        hasAds: boolean;
        purchases: number;
        purchasedPlans: string[];
        purchasedAddons: string[];
        purchasedItems: { itemType: string; itemId: string }[];
      }
    > = {};

    const addUnique = (arr: string[], value: string) => {
      if (!value) return;
      if (!arr.includes(value)) arr.push(value);
    };

    const addUniqueItem = (
      arr: { itemType: string; itemId: string }[],
      itemType: string,
      itemId: string,
    ) => {
      if (!itemType || !itemId) return;
      const exists = arr.some((x) => x.itemType === itemType && x.itemId === itemId);
      if (!exists) arr.push({ itemType, itemId });
    };

    for (const c of commissions) {
      const id =
        c.referredUserId ||
        ((c.metadata as any)?.referredUserId as string | undefined) ||
        ((c.metadata as any)?.userId as string | undefined) ||
        null;
      if (!id) continue;

      const createdAt = c.createdAt ? new Date(c.createdAt) : new Date();
      const itemType = (c.metadata as any)?.itemType as string | undefined;
      const itemId = (c.metadata as any)?.itemId as string | undefined;

      const nameFromMetadata =
        ((c.metadata as any)?.referredUserName as string | undefined) ||
        ((c.metadata as any)?.userName as string | undefined) ||
        null;

      const emailFromMetadata =
        ((c.metadata as any)?.referredUserEmail as string | undefined) ||
        ((c.metadata as any)?.userEmail as string | undefined) ||
        null;

      if (!byUser[id]) {
        byUser[id] = {
          referredUserId: id,
          referredUserName: nameFromMetadata,
          referredUserEmail: emailFromMetadata,
          firstSeenAt: createdAt.toISOString(),
          lastSeenAt: createdAt.toISOString(),
          hasPlan: false,
          hasGrowthEngine: false,
          hasAds: false,
          purchases: 0,
          purchasedPlans: [],
          purchasedAddons: [],
          purchasedItems: [],
        };
      }

      const current = byUser[id];
      current.purchases += 1;

      if (!current.referredUserName && nameFromMetadata) {
        current.referredUserName = nameFromMetadata;
      }
      if (!current.referredUserEmail && emailFromMetadata) {
        current.referredUserEmail = emailFromMetadata;
      }

      const currentFirst = new Date(current.firstSeenAt);
      const currentLast = new Date(current.lastSeenAt);
      if (createdAt < currentFirst) current.firstSeenAt = createdAt.toISOString();
      if (createdAt > currentLast) current.lastSeenAt = createdAt.toISOString();

      if (typeof itemType === 'string' && typeof itemId === 'string') {
        addUniqueItem(current.purchasedItems, itemType, itemId);
      }

      if (itemType === 'plan' && typeof itemId === 'string') {
        current.hasPlan = true;
        addUnique(current.purchasedPlans, itemId);
      }

      if (itemType === 'addon' && typeof itemId === 'string') {
        addUnique(current.purchasedAddons, itemId);

        if (itemId.toLowerCase().startsWith('motor de crescimento')) {
          current.hasGrowthEngine = true;
        }
        if (itemId.toLowerCase().startsWith('anúncio')) {
          current.hasAds = true;
        }
      }
    }

    const referredUsers = Object.values(byUser).sort(
      (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
    );

    return { referredUserIds: ids, referredUsers };
  }

  // -------- Área administrativa --------

  // Lista comissões com filtro simples por status
  @Get('admin/commissions')
  async listAllCommissions(@Query('status') status?: 'pending' | 'paid') {
    const where = status ? { status } : {};
    const commissions = await this.affiliateRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });

    return commissions;
  }

  @Get('admin/summary')
  async getAdminSummary() {
    const itemTypeExpr = "COALESCE(c.metadata->>'itemType', 'unknown')";
    const itemIdExpr = "COALESCE(c.metadata->>'itemId', '')";
    const productTypeExpr = `
      CASE
        WHEN ${itemTypeExpr} = 'plan' THEN 'plan'
        WHEN ${itemTypeExpr} = 'addon' AND ${itemIdExpr} ILIKE 'Motor de Crescimento%' THEN 'growth_engine'
        WHEN ${itemTypeExpr} = 'addon' AND ${itemIdExpr} ILIKE 'Anúncio%' THEN 'ads'
        WHEN ${itemTypeExpr} = 'addon' THEN 'addon_other'
        ELSE 'unknown'
      END
    `;

    const rows = await this.affiliateRepo
      .createQueryBuilder('c')
      .select('c.affiliate_code', 'affiliateCode')
      .addSelect(itemTypeExpr, 'itemType')
      .addSelect(itemIdExpr, 'itemId')
      .addSelect(productTypeExpr, 'productType')
      .addSelect('c.currency', 'currency')
      .addSelect("COUNT(*) FILTER (WHERE c.status = 'pending')", 'pendingCount')
      .addSelect("COUNT(*) FILTER (WHERE c.status = 'paid')", 'paidCount')
      .addSelect('COUNT(*)', 'totalCount')
      .addSelect(
        "COALESCE(SUM(CASE WHEN c.status = 'pending' THEN c.amount::numeric ELSE 0 END), 0)",
        'pendingAmount',
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount::numeric ELSE 0 END), 0)",
        'paidAmount',
      )
      .addSelect('COALESCE(SUM(c.amount::numeric), 0)', 'totalAmount')
      .groupBy('c.affiliate_code')
      .addGroupBy(itemTypeExpr)
      .addGroupBy(itemIdExpr)
      .addGroupBy(productTypeExpr)
      .addGroupBy('c.currency')
      .orderBy('c.affiliate_code', 'ASC')
      .addOrderBy(productTypeExpr, 'ASC')
      .getRawMany();

    const summary = rows.map((r: any) => ({
      affiliateCode: r.affiliateCode,
      itemType: r.itemType,
      itemId: r.itemId,
      productType: r.productType,
      currency: r.currency,
      pendingCount: Number(r.pendingCount || 0),
      paidCount: Number(r.paidCount || 0),
      totalCount: Number(r.totalCount || 0),
      pendingAmount: Number(Number(r.pendingAmount || 0).toFixed(2)),
      paidAmount: Number(Number(r.paidAmount || 0).toFixed(2)),
      totalAmount: Number(Number(r.totalAmount || 0).toFixed(2)),
    }));

    return { summary };
  }

  // Marca uma comissão como paga
  @Patch('admin/commissions/:id/mark-paid')
  async markCommissionAsPaid(@Param('id') id: string) {
    const commission = await this.affiliateRepo.findOne({ where: { id } });
    if (!commission) {
      return { ok: false, message: 'Comissão não encontrada' };
    }

    commission.status = 'paid';
    commission.paidAt = new Date();

    const saved = await this.affiliateRepo.save(commission);
    return { ok: true, commission: saved };
  }
}