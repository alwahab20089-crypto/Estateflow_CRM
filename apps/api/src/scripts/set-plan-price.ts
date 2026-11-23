// Usage (from apps/api):  npx tsx src/scripts/set-plan-price.ts <planSlug> <MONTH|YEAR> <pri_...>
// Connects one EstateFlow plan price to the Paddle price that bills it. Safe to re-run: it replaces only the Paddle id.
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Plan } from '../modules/commercial/commercial.model';

const PROVIDER = 'paddle';
const usage = () => {
  console.error('Usage: npx tsx src/scripts/set-plan-price.ts <planSlug> <MONTH|YEAR> <pri_...>');
  process.exit(1);
};

async function main() {
  const [slug, interval, priceId] = process.argv.slice(2);
  if (!slug || (interval !== 'MONTH' && interval !== 'YEAR') || !priceId || !/^pri_[A-Za-z0-9]+$/.test(priceId)) usage();

  await connectDatabase();
  try {
    const plan = await Plan.findOne({ slug });
    if (!plan) throw new Error(`No plan with slug "${slug}". Run the plan seed first.`);
    if (plan.isFallback) throw new Error(`"${slug}" is the fallback plan: it is not purchased, so it has no Paddle price.`);
    const price = plan.prices.find((p) => p.interval === interval);
    if (!price) throw new Error(`Plan "${slug}" has no ${interval} price. Add it to the plan first.`);

    // One Paddle price must map to exactly one EstateFlow plan price, or webhooks could grant the wrong plan.
    const clash = await Plan.findOne({ prices: { $elemMatch: { variants: { $elemMatch: { provider: PROVIDER, variantId: priceId } } } } });
    const clashInterval = clash?.prices.find((p) => p.variants.some((v) => v.provider === PROVIDER && v.variantId === priceId))?.interval;
    if (clash && (clash.slug !== slug || clashInterval !== interval)) {
      throw new Error(`That Paddle price is already connected to "${clash.slug}" (${clashInterval}).`);
    }

    const kept = price.variants.filter((v) => v.provider !== PROVIDER).map((v) => ({ provider: v.provider, variantId: v.variantId }));
    price.set('variants', [...kept, { provider: PROVIDER, variantId: priceId }]);
    await plan.save();

    console.log(`Connected ${slug} / ${interval} -> ${priceId}`);
    console.log(`EstateFlow displays ${(price.amount / 100).toFixed(2)} ${price.currency}. The Paddle price must be the same amount and currency.`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});