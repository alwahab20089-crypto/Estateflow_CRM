// VENDOR TOOL. Run it on YOUR machine, never on a customer install, and never commit the private key.
//
//   npx tsx src/scripts/license-tool.ts keygen --out ./license-keys
//   npx tsx src/scripts/license-tool.ts issue --private-key ./license-keys/license-private.pem \
//       --licensee "Awan Properties" --edition PROFESSIONAL --days 365
//   npx tsx src/scripts/license-tool.ts issue ... --perpetual          (no end date)
//   npx tsx src/scripts/license-tool.ts inspect --public-key ./license-keys/license-public.pem --key "EF1...."
//
// It imports only the crypto and catalog modules, so it needs no database and no .env file.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { LICENSE_EDITIONS, type LicenseEdition } from '../constants';
import { EDITION_PRESETS } from '../modules/licensing/license.catalog';
import { parsePrivateKey, parsePublicKey, signLicense, verifyLicense, type LicensePayload } from '../modules/licensing/license.crypto';

const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    out: { type: 'string' },
    'private-key': { type: 'string' },
    'public-key': { type: 'string' },
    key: { type: 'string' },
    licensee: { type: 'string' },
    edition: { type: 'string' },
    days: { type: 'string' },
    perpetual: { type: 'boolean', default: false },
  },
});

if (command === 'keygen') {
  const dir = values.out ?? die('keygen needs --out <directory>');
  const privatePath = join(dir, 'license-private.pem');
  const publicPath = join(dir, 'license-public.pem');
  if (existsSync(privatePath) || existsSync(publicPath)) die('Refusing to overwrite existing keys. Choose another --out.');
  mkdirSync(dir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log(`Private key (KEEP SECRET, back it up, never commit): ${privatePath}`);
  console.log(`Public key (goes into every install as LICENSE_PUBLIC_KEY): ${publicPath}`);
} else if (command === 'issue') {
  const privatePath = values['private-key'] ?? die('issue needs --private-key <file>');
  const licensee = values.licensee ?? die('issue needs --licensee "<customer name>"');
  const edition = (values.edition ?? die('issue needs --edition STANDARD|PROFESSIONAL|AGENCY')) as LicenseEdition;
  if (!LICENSE_EDITIONS.includes(edition)) die(`--edition must be one of ${LICENSE_EDITIONS.join(', ')}`);
  if (!values.perpetual && !values.days) die('issue needs --days <number> or --perpetual');

  const now = new Date();
  const days = Number(values.days);
  if (!values.perpetual && (!Number.isInteger(days) || days < 1 || days > 3650)) die('--days must be a whole number from 1 to 3650');

  const payload: LicensePayload = {
    v: 1,
    jti: randomUUID(),
    licensee,
    edition,
    ...EDITION_PRESETS[edition],
    issuedAt: now.toISOString(),
    expiresAt: values.perpetual ? null : new Date(now.getTime() + days * 86_400_000).toISOString(),
  };
  const key = signLicense(payload, parsePrivateKey(readFileSync(privatePath, 'utf8')));
  console.log(JSON.stringify(payload, null, 2));
  console.log('\nLicense key (send this to the customer):\n');
  console.log(key);
} else if (command === 'inspect') {
  const publicPath = values['public-key'] ?? die('inspect needs --public-key <file>');
  const key = values.key ?? die('inspect needs --key "<license key>"');
  try {
    console.log(JSON.stringify(verifyLicense(key, parsePublicKey(readFileSync(publicPath, 'utf8'))).payload, null, 2));
  } catch {
    die('INVALID: the signature or the format is wrong.');
  }
} else {
  die('Usage: license-tool.ts <keygen|issue|inspect> [options]. See the comment at the top of this file.');
}