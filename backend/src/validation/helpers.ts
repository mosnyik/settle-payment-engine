import { z } from 'zod';

export const shortStr = (max = 50) => z.string().trim().min(1).max(max);

export const longStr = (max = 255) => z.string().trim().max(max);

export const amountStr = (maxDigits = 13, maxDecimals = 8) =>
  z.string().refine((v) => {
    const [i, d = ''] = v.split('.');
    return i.length + d.length <= maxDigits && d.length <= maxDecimals;
  });

export const dateField = z.union([z.string(), z.date()]).optional();
