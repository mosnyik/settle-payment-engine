/**
 * ID Generator Tests
 *
 * Tests for payment ID and reference generation.
 * These are pure functions with no external dependencies.
 */

import { describe, it, expect } from 'vitest';
import {
  generatePaymentId,
  generatePaymentReference,
  generatePaymentIds,
  isValidPaymentId,
  isValidPaymentReference,
} from '@/services/payment-engine/utils/id-generator';

describe('ID Generator', () => {
  // ===========================================================================
  // generatePaymentId
  // ===========================================================================

  describe('generatePaymentId', () => {
    it('should generate an ID with "pay_" prefix', () => {
      const id = generatePaymentId();
      expect(id.startsWith('pay_')).toBe(true);
    });

    it('should generate an ID of exactly 30 characters', () => {
      const id = generatePaymentId();
      expect(id.length).toBe(30); // 4 (prefix) + 26 (random)
    });

    it('should only contain alphanumeric characters after prefix', () => {
      const id = generatePaymentId();
      const randomPart = id.slice(4);
      expect(/^[a-zA-Z0-9]+$/.test(randomPart)).toBe(true);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        ids.add(generatePaymentId());
      }

      // All 1000 IDs should be unique
      expect(ids.size).toBe(count);
    });

    it('should generate IDs with mixed case', () => {
      // Generate several IDs and check that at least some have mixed case
      const ids = Array.from({ length: 100 }, () => generatePaymentId());
      const randomParts = ids.map(id => id.slice(4));

      const hasLowercase = randomParts.some(part => /[a-z]/.test(part));
      const hasUppercase = randomParts.some(part => /[A-Z]/.test(part));
      const hasDigits = randomParts.some(part => /[0-9]/.test(part));

      expect(hasLowercase).toBe(true);
      expect(hasUppercase).toBe(true);
      expect(hasDigits).toBe(true);
    });
  });

  // ===========================================================================
  // generatePaymentReference
  // ===========================================================================

  describe('generatePaymentReference', () => {
    it('should generate a reference with "2S-" prefix', () => {
      const ref = generatePaymentReference();
      expect(ref.startsWith('2S-')).toBe(true);
    });

    it('should generate a reference of exactly 9 characters', () => {
      const ref = generatePaymentReference();
      expect(ref.length).toBe(9); // 3 (prefix) + 6 (random)
    });

    it('should only contain uppercase alphanumeric characters after prefix', () => {
      const ref = generatePaymentReference();
      const randomPart = ref.slice(3);
      expect(/^[A-Z0-9]+$/.test(randomPart)).toBe(true);
    });

    it('should not contain ambiguous characters (0, 1, I, L, O)', () => {
      // Generate many references to increase confidence
      const refs = Array.from({ length: 1000 }, () => generatePaymentReference());
      const randomParts = refs.map(ref => ref.slice(3));

      for (const part of randomParts) {
        expect(part).not.toContain('0');
        expect(part).not.toContain('1');
        expect(part).not.toContain('I');
        expect(part).not.toContain('L');
        expect(part).not.toContain('O');
      }
    });

    it('should generate unique references', () => {
      const refs = new Set<string>();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        refs.add(generatePaymentReference());
      }

      // All 1000 refs should be unique
      expect(refs.size).toBe(count);
    });
  });

  // ===========================================================================
  // generatePaymentIds
  // ===========================================================================

  describe('generatePaymentIds', () => {
    it('should return an object with id and reference', () => {
      const ids = generatePaymentIds();

      expect(ids).toHaveProperty('id');
      expect(ids).toHaveProperty('reference');
    });

    it('should generate valid id and reference', () => {
      const ids = generatePaymentIds();

      expect(ids.id.startsWith('pay_')).toBe(true);
      expect(ids.id.length).toBe(30);

      expect(ids.reference.startsWith('2S-')).toBe(true);
      expect(ids.reference.length).toBe(9);
    });
  });

  // ===========================================================================
  // isValidPaymentId
  // ===========================================================================

  describe('isValidPaymentId', () => {
    it('should return true for valid payment IDs', () => {
      const id = generatePaymentId();
      expect(isValidPaymentId(id)).toBe(true);
    });

    it('should return false for IDs without "pay_" prefix', () => {
      expect(isValidPaymentId('abc_abcdefghijklmnopqrstuvwxyz')).toBe(false);
      expect(isValidPaymentId('abcdefghijklmnopqrstuvwxyz1234')).toBe(false);
    });

    it('should return false for IDs with wrong length', () => {
      expect(isValidPaymentId('pay_abc')).toBe(false); // Too short
      expect(isValidPaymentId('pay_abcdefghijklmnopqrstuvwxyz123')).toBe(false); // Too long
    });

    it('should return false for IDs with invalid characters', () => {
      expect(isValidPaymentId('pay_abcdefghijklmnopqrst!@#$%^')).toBe(false);
      expect(isValidPaymentId('pay_abcdefghijklmnopqrstuvwx-_')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidPaymentId('')).toBe(false);
    });
  });

  // ===========================================================================
  // isValidPaymentReference
  // ===========================================================================

  describe('isValidPaymentReference', () => {
    it('should return true for valid payment references', () => {
      const ref = generatePaymentReference();
      expect(isValidPaymentReference(ref)).toBe(true);
    });

    it('should return false for references without "2S-" prefix', () => {
      expect(isValidPaymentReference('AB-CDEFGH')).toBe(false);
      expect(isValidPaymentReference('ABCDEFGHI')).toBe(false);
    });

    it('should return false for references with wrong length', () => {
      expect(isValidPaymentReference('2S-ABC')).toBe(false); // Too short
      expect(isValidPaymentReference('2S-ABCDEFG')).toBe(false); // Too long
    });

    it('should return false for references with lowercase letters', () => {
      expect(isValidPaymentReference('2S-abcdef')).toBe(false);
      expect(isValidPaymentReference('2S-AbCdEf')).toBe(false);
    });

    it('should return false for references with ambiguous characters', () => {
      expect(isValidPaymentReference('2S-ABCD0E')).toBe(false); // Contains 0
      expect(isValidPaymentReference('2S-ABCD1E')).toBe(false); // Contains 1
      expect(isValidPaymentReference('2S-ABCDIE')).toBe(false); // Contains I
      expect(isValidPaymentReference('2S-ABCDLE')).toBe(false); // Contains L
      expect(isValidPaymentReference('2S-ABCDOE')).toBe(false); // Contains O
    });

    it('should return false for empty string', () => {
      expect(isValidPaymentReference('')).toBe(false);
    });
  });
});
