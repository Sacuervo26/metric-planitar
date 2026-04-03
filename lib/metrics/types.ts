export type CsvRow = Record<string, string>;

export type PresetMode =
  | "manual"
  | "combined"
  | "std"
  | "premium"
  | "ads_std"
  | "ads_prem"
  | "gt10k";

export type TeamComparisonRow = {
  team: string;
  draftFiles: number;
  draftHours: number;
  draftRate: number;
  qer: number;
  qaFiles: number;
  qaHours: number;
  qaRate: number;
};

export type WeeklySummaryRow = {
  weekLabel: string;
  firstDay: string;
  lastDay: string;
  fileCount: number;
  propertySF: number;
  time: number;
  avgDraftRate: number;
  avgQER: number;
  avgL1: number;
  avgL2: number;
  avgL3: number;
  qaFiles: number;
  qaPropertySF: number;
  qaTime: number;
  avgQARate: number;
  isTotal?: boolean;
};

export type WeeklyTeamRow = {
  team: string;
  weekLabel: string;
  firstDay: string;
  lastDay: string;
  draftFiles: number;
  draftHours: number;
  draftRate: number;
  qer: number;
  qaFiles: number;
  qaHours: number;
  qaRate: number;
};

export type TeamMemberWeeklyRow = {
  team: string;
  name: string;
  weekLabel: string;
  firstDay: string;
  lastDay: string;
  draftFiles: number;
  draftHours: number;
  draftRate: number;
  qaFiles: number;
  qaHours: number;
  qaRate: number;
  qer: number;
  l1: number;
  l2: number;
  l3: number;
};
