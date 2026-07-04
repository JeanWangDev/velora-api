export const TEMPLATE_USAGE_APPLY = "apply";
export const TEMPLATE_USAGE_COPY = "copy";

export type TemplateUsageEventType =
  | typeof TEMPLATE_USAGE_APPLY
  | typeof TEMPLATE_USAGE_COPY;

export type TemplateRankingPeriod = "week" | "month";

export type ChartTemplateRankingRecord = {
  rank: number;
  templateId: string;
  applyCount: number;
  copyCount: number;
  score: number;
  name: string;
  symbolId: number | null;
  symbol: string;
  indicatorIds: string[];
  visibility: "public";
  isDefault: boolean;
  isOfficial: boolean;
  createdAt: number;
  updatedAt: number;
};
