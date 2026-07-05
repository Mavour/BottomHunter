import { filterTrending, checkTokenAge, calcVsAthPct } from '../src/filters';
import { FilterConfig, GmgnTrending } from '../src/types';

const defaultConfig: FilterConfig = {
  rug_check: { renounced_mint: true, renounced_freeze_account: true },
  top_10_holder_rate_max: 60,
  vol24h_min: 1000,
  mcap_min: 10000,
  mcap_max: 0,
  min_liquidity_usd: 0,
  min_holders: 0,
  min_fee_sol: 30,
  vs_ath_pct_min: 0,
  vs_ath_pct_max: 95,
  require_not_wash_trading: false,
  require_has_social: false,
  require_not_honeypot: false,
  min_token_age_hours: 6,
};

function makeToken(overrides: Partial<GmgnTrending> = {}): GmgnTrending {
  return {
    address: 'TestMint1111111111111111111111111111111111',
    symbol: 'TEST',
    name: 'Test Token',
    price: 0.001,
    price_change_5m: 2.5,
    price_change_1h: 5.0,
    price_change_24h: 10.0,
    market_cap: 100000,
    liquidity: 50000,
    volume_24h: 20000,
    swaps: 500,
    holder_count: 500,
    top_10_holder_rate: 40,
    dev_team_hold_rate: 5,
    suspected_insider_hold_rate: 10,
    rat_trader_amount_rate: 5,
    bundler_trader_amount_rate: 10,
    smart_degen_count: 3,
    bot_degen_count: 5,
    renowned_count: 1,
    sniper_count: 20,
    renounced_mint: true,
    renounced_freeze_account: true,
    is_wash_trading: false,
    open_timestamp: Math.floor(Date.now() / 1000) - 4 * 3600, // 4h ago
    created_timestamp: Math.floor(Date.now() / 1000) - 5 * 3600,
    is_honeypot: false,
    has_at_least_one_social: true,
    rug_ratio: 0,
    ...overrides,
  };
}

describe('filterTrending', () => {
  it('passes a clean token', () => {
    const result = filterTrending(makeToken(), defaultConfig);
    expect(result.passed).toBe(true);
  });

  it('rejects unrenounced mint when required', () => {
    const result = filterTrending(makeToken({ renounced_mint: false }), defaultConfig);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Mint');
  });

  it('rejects when top10 holder rate exceeds max', () => {
    const result = filterTrending(makeToken({ top_10_holder_rate: 75 }), defaultConfig);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('top10');
  });

  it('rejects when volume below min', () => {
    const result = filterTrending(makeToken({ volume_24h: 500 }), defaultConfig);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('vol24h');
  });

  it('rejects when mcap below min', () => {
    const result = filterTrending(makeToken({ market_cap: 1000 }), defaultConfig);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('mcap');
  });
});

describe('checkTokenAge', () => {
  it('passes token older than minAgeHours', () => {
    const openTs = Math.floor(Date.now() / 1000) - 5 * 3600; // 5h ago
    const result = checkTokenAge(openTs, 3);
    expect(result.ok).toBe(true);
  });

  it('rejects token younger than minAgeHours', () => {
    const openTs = Math.floor(Date.now() / 1000) - 1 * 3600; // 1h ago
    const result = checkTokenAge(openTs, 3);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('age');
  });

  it('rejects token with open_timestamp = 0', () => {
    const result = checkTokenAge(0, 3);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('never opened');
  });
});

describe('calcVsAthPct', () => {
  it('calculates correct vsATH percentage', () => {
    expect(calcVsAthPct(0.8, 1.0)).toBeCloseTo(20, 1);
    expect(calcVsAthPct(0.5, 1.0)).toBeCloseTo(50, 1);
    expect(calcVsAthPct(1.0, 1.0)).toBeCloseTo(0, 1);
  });

  it('returns 0 when athPrice is missing or 0', () => {
    expect(calcVsAthPct(0.8, 0)).toBe(0);
    expect(calcVsAthPct(0.8, null as unknown as number)).toBe(0);
  });
});