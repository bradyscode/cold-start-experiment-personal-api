import type { Agg, Bucket } from '../api/types';

export type Better = 'higher' | 'lower' | 'none';

export type DatedValue = { date: string; value: number };

export type KindOverview = {
  kind: string;
  displayName: string;
  category: string | null;
  agg: Agg;
  unit: string | null;
  better: Better | null;
  value: number | null;
  previousValue: number | null;
  delta: number | null;
  deltaPercent: number | null;
  avgPerDay: number | null;
  entries: number;
  previousEntries: number;
  activeDays: number;
  best: DatedValue | null;
  latest: DatedValue | null;
  lastEntryAt: string | null;
  currentStreak: number;
  longestStreak: number;
  values: (number | null)[];
  previousValues: (number | null)[];
  counts: number[];
  activity: number[];
  // Set when this tracker could not be computed (for example too many records); the numbers are then empty.
  error?: string | null;
};

export type Overview = {
  days: number;
  activityDays: number;
  generatedAt: string;
  dates: string[];
  previousDates: string[];
  activityDates: string[];
  activityTotal: number[];
  kinds: KindOverview[];
};

export type SeriesStats = {
  n: number;
  total: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
  slope: number | null;
};

export type CompareSeries = {
  kind: string;
  displayName: string;
  category: string | null;
  agg: Agg;
  unit: string | null;
  values: (number | null)[];
  stats: SeriesStats;
};

export type PairResult = {
  a: string;
  b: string;
  lag: number;
  r: number | null;
  r2: number | null;
  n: number;
  slope: number | null;
  intercept: number | null;
  reason: string | null;
};

export type Compare = { days: number; bucket: Bucket; dates: string[]; series: CompareSeries[]; pairs: PairResult[] };

export type PairDetail = {
  days: number;
  bucket: Bucket;
  dates: string[];
  a: CompareSeries;
  b: CompareSeries;
  lags: PairResult[];
  bestLag: number | null;
};
