export interface PaystackBankLike {
  name: string;
  code: string;
  slug?: string;
  longcode?: string;
  nip_code?: string | number | null;
  nip_sort_code?: string | number | null;
  nipCode?: string | number | null;
  nipSortCode?: string | number | null;
  institution_code?: string | number | null;
  institutionCode?: string | number | null;
  [key: string]: unknown;
}

export interface PaystackBankMatch {
  bank: PaystackBankLike;
  score: number;
  reason: 'paystack-code' | 'nip-code' | 'alias' | 'name';
}

const BANK_ALIASES: Record<string, string[]> = {
  opay: ['paycom'],
  'o pay': ['paycom'],
  paycom: ['opay', 'o pay'],
  moniepoint: ['teamapt'],
  teamapt: ['moniepoint'],
  palmpay: ['palm pay'],
  'palm pay': ['palmpay'],
  kuda: ['kuda microfinance'],
  carbon: ['one finance', 'carbon microfinance'],
  fairmoney: ['fairmoney microfinance'],
  eyowo: ['eyowo microfinance'],
};

export function normalizeBankCode(code: string | number | null | undefined): string {
  return String(code ?? '').trim();
}

function bankCodeCandidates(code: string): string[] {
  const normalized = normalizeBankCode(code);
  const withoutLeadingZeroes = normalized.replace(/^0+/, '');
  return [...new Set([normalized, withoutLeadingZeroes].filter(Boolean))];
}

export function normalizeBankName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(bank|microfinance|mfb|mfbank|finance|limited|ltd|plc|ng|nigeria|nigerian|digital|services)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getPaystackNipCodes(bank: PaystackBankLike): string[] {
  const values = [
    bank.nip_code,
    bank.nip_sort_code,
    bank.nipCode,
    bank.nipSortCode,
    bank.institution_code,
    bank.institutionCode,
    bank.longcode,
  ];

  return [...new Set(values.map(normalizeBankCode).filter(Boolean))];
}

export function similarity(a: string, b: string): number {
  const wa = new Set(normalizeBankName(a).split(' ').filter(Boolean));
  const wb = new Set(normalizeBankName(b).split(' ').filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;

  let matches = 0;
  for (const w of wa) {
    if (wb.has(w)) matches++;
  }

  return matches / Math.max(wa.size, wb.size);
}

function aliasMatchScore(localName: string, paystackName: string): number {
  const local = normalizeBankName(localName);
  const remote = normalizeBankName(paystackName);
  const aliases = BANK_ALIASES[local] ?? [];

  if (aliases.some(alias => normalizeBankName(alias) === remote)) return 0.95;

  for (const [canonical, canonicalAliases] of Object.entries(BANK_ALIASES)) {
    const normalizedAliases = canonicalAliases.map(normalizeBankName);
    if (
      (local === canonical || normalizedAliases.includes(local)) &&
      (remote === canonical || normalizedAliases.includes(remote))
    ) {
      return 0.95;
    }
  }

  return 0;
}

export function findPaystackBankMatch(
  localCode: string,
  localName: string | undefined,
  paystackBanks: PaystackBankLike[],
  minimumNameScore = 0.5
): PaystackBankMatch | null {
  const code = normalizeBankCode(localCode);
  const codeCandidates = bankCodeCandidates(code);

  const exactPaystackCode = paystackBanks.find(bank => codeCandidates.includes(normalizeBankCode(bank.code)));
  if (exactPaystackCode) {
    return { bank: exactPaystackCode, score: 1, reason: 'paystack-code' };
  }

  const exactNipCode = paystackBanks.find(bank =>
    getPaystackNipCodes(bank).some(nipCode =>
      bankCodeCandidates(nipCode).some(candidate => codeCandidates.includes(candidate))
    )
  );
  if (exactNipCode) {
    return { bank: exactNipCode, score: 1, reason: 'nip-code' };
  }

  if (!localName) return null;

  let bestAlias: PaystackBankLike | null = null;
  let bestAliasScore = 0;
  for (const bank of paystackBanks) {
    const score = aliasMatchScore(localName, bank.name);
    if (score > bestAliasScore) {
      bestAliasScore = score;
      bestAlias = bank;
    }
  }
  if (bestAlias && bestAliasScore > 0) {
    return { bank: bestAlias, score: bestAliasScore, reason: 'alias' };
  }

  let bestName: PaystackBankLike | null = null;
  let bestNameScore = minimumNameScore;
  for (const bank of paystackBanks) {
    const score = similarity(localName, bank.name);
    if (score > bestNameScore) {
      bestNameScore = score;
      bestName = bank;
    }
  }

  return bestName ? { bank: bestName, score: bestNameScore, reason: 'name' } : null;
}
