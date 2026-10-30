export type FieldDef = {
  name: string;
  type: 'Text' | 'Number' | 'Boolean' | 'Date' | 'Choice';
  required: boolean;
  label?: string | null;
  options?: string[] | null;
  min?: number | null;
  max?: number | null;
  integer?: boolean;
};

export type Kind = {
  key: string;
  displayName: string;
  defaultUnit: string | null;
  valueField: string | null;
  fields: FieldDef[];
  category?: string | null;
  defaultAgg?: 'sum' | 'avg' | 'max' | 'count' | null;
  better?: 'higher' | 'lower' | 'none' | null;
};

export type LifeRecord = {
  id: string;
  source: string;
  kind: string;
  occurredAt: string;
  value: number | null;
  unit: string | null;
  title: string;
  data: Record<string, unknown> | null;
  externalId: string | null;
  createdAt: string;
};

export type Bucket = 'day' | 'week';
export type Agg = 'sum' | 'avg' | 'max' | 'count';

export type SeriesPoint = { start: string; date: string; value: number | null; count: number };

export type Series = {
  kind: string;
  bucket: Bucket;
  agg: Agg;
  unit: string | null;
  points: SeriesPoint[];
};

export type FeedCard = {
  id: string;
  kind: string;
  kindName: string;
  rule: 'personal_best' | 'streak' | 'vs_average' | 'milestone' | 'weekly';
  big: string;
  unit: string | null;
  headline: string;
  detail: string;
  occurredAt: string;
  score: number;
  chart: { kind: string; bucket: Bucket; agg: Agg; days: number };
};

export class ApiError extends Error {
  status: number;
  errors: string[];

  constructor(status: number, message: string, errors: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}
