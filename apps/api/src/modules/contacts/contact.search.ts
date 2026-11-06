interface DerivableContact {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  alternatePhone?: string | null;
  company?: string | null;
}

/** Search tokens (matched by anchored prefix via buildSearchFilter) and a lowercase name for sorting. */
export function deriveContactFields(c: DerivableContact) {
  const keywords = new Set<string>();
  for (const part of `${c.firstName} ${c.lastName ?? ''}`.toLowerCase().split(/\s+/)) if (part) keywords.add(part);
  if (c.email) {
    const email = c.email.toLowerCase();
    keywords.add(email);
    keywords.add(email.split('@')[0]!);
  }
  for (const phone of [c.phone, c.alternatePhone]) if (phone) keywords.add(phone.replace(/^\+/, ''));
  for (const word of (c.company ?? '').toLowerCase().split(/\s+/)) {
    const clean = word.replace(/[^\p{L}\p{N}]/gu, '');
    if (clean) keywords.add(clean);
  }
  return {
    searchKeywords: [...keywords].slice(0, 30),
    nameSort: `${c.firstName} ${c.lastName ?? ''}`.trim().toLowerCase(),
  };
}