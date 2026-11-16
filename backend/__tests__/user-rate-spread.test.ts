import { afterEach, describe, expect, it, vi } from 'vitest';
import config, { DEFAULT_USER_RATE_SPREAD, parseUserRateSpread } from '../src/config';
import { applyUserRateSpread } from '../src/services/payment-engine/rate/rate-service';

describe('USER_RATE_SPREAD', () => {
  const original = config.rateEngine.userSpread;
  afterEach(() => {
    config.rateEngine.userSpread = original;
    vi.restoreAllMocks();
  });

  it('defaults to 1% when unset or blank', () => {
    expect(DEFAULT_USER_RATE_SPREAD).toBe(0.01);
    expect(parseUserRateSpread(undefined)).toBe(0.01);
    expect(parseUserRateSpread('  ')).toBe(0.01);
  });

  it('accepts a valid fraction, including 0', () => {
    expect(parseUserRateSpread('0.015')).toBe(0.015);
    expect(parseUserRateSpread('0')).toBe(0);
  });

  it('falls back to 1% with a warning for invalid values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['abc', '-0.01', '1', '5', 'NaN']) {
      expect(parseUserRateSpread(bad)).toBe(0.01);
    }
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it('applies the configured spread to user rates', () => {
    config.rateEngine.userSpread = 0.02;
    expect(applyUserRateSpread(1500)).toBeCloseTo(1470, 6);
    config.rateEngine.userSpread = 0.01;
    expect(applyUserRateSpread(1500)).toBeCloseTo(1485, 6);
  });
});
