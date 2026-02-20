/**
 * ID Generator
 */

const MACHINE_ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const HUMAN_REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateRandomString(length: number, chars: string): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }
  return result;
}

export function generatePaymentId(): string {
  const prefix = 'pay_';
  const randomPart = generateRandomString(26, MACHINE_ID_CHARS);
  return prefix + randomPart;
}

export function generatePaymentReference(): string {
  const prefix = '2S-';
  const randomPart = generateRandomString(6, HUMAN_REF_CHARS);
  return prefix + randomPart;
}

export function generatePaymentIds(): { id: string; reference: string } {
  return {
    id: generatePaymentId(),
    reference: generatePaymentReference(),
  };
}

export function isValidPaymentId(id: string): boolean {
  if (!id.startsWith('pay_')) return false;
  if (id.length !== 30) return false;
  const randomPart = id.slice(4);
  for (const char of randomPart) {
    if (!MACHINE_ID_CHARS.includes(char)) return false;
  }
  return true;
}

export function isValidPaymentReference(reference: string): boolean {
  if (!reference.startsWith('2S-')) return false;
  if (reference.length !== 9) return false;
  const randomPart = reference.slice(3);
  for (const char of randomPart) {
    if (!HUMAN_REF_CHARS.includes(char)) return false;
  }
  return true;
}
