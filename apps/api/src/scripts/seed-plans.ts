import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Plan } from '../modules/commercial/commercial.model';
import { EXAMPLE_PLANS } from '../modules/commercial/plans.seed';

async function main() {
  await connectDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  for (const p of EXAMPLE_PLANS) {
    // $setOnInsert: re-running never overwrites prices, limits or provider variant ids you edited.
    await Plan.updateOne({ slug: p.slug }, { $setOnInsert: { ...p, isActive: true } }, { upsert: true });
  }
  console.log(`Seeded ${EXAMPLE_PLANS.length} example plans (existing plans were left untouched).`);
  await disconnectDatabase();
}
main().catch((err) => { console.error(err); process.exit(1); });