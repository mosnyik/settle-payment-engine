export type { SettlementProvider, SettlementTransferResult } from './types';
export { HyparrowSettlementProvider, hyparrowSettlementProvider } from './hyparrow.provider';

import { SettlementProvider } from './types';
import { hyparrowSettlementProvider } from './hyparrow.provider';

// Registered provider set. Add new settlement rails here.
export const ALL_SETTLEMENT_PROVIDERS: SettlementProvider[] = [
  hyparrowSettlementProvider,
];
