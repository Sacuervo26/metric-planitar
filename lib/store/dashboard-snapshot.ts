import type {
  PresetMode,
  TeamComparisonRow,
  TeamMemberWeeklyRow,
  WeeklySummaryRow,
  WeeklyTeamRow,
} from "@/lib/metrics/types";

export const DASHBOARD_SNAPSHOT_KEY = "metric-planitar-dashboard-snapshot";
export const DASHBOARD_SNAPSHOT_EVENT = "metric-planitar-dashboard-snapshot-updated";

export type TeamLeaderRow = {
  team: string;
  name: string;
  rate: number;
  files: number;
  hours: number;
};

export type PresetDistributionRow = {
  preset: PresetMode;
  label: string;
  draftRows: number;
  qaRows: number;
  totalRows: number;
  totalHours: number;
};

export type SnapshotPresetMode = Exclude<PresetMode, "manual">;

export type TeamComparisonByPreset = Partial<
  Record<SnapshotPresetMode, TeamComparisonRow[]>
>;

export type TeamMemberSnapshotRow = {
  team: string;
  name: string;
  draftFiles: number;
  draftSqft: number;
  draftHours: number;
  draftRate: number;
  qaFiles: number;
  qaSqft: number;
  qaHours: number;
  qaRate: number;
  qer: number;
  l1: number;
  l2: number;
  l3: number;
};

export type TeamMembersByPreset = Partial<
  Record<SnapshotPresetMode, TeamMemberSnapshotRow[]>
>;

export type WeeklyTeamsByPreset = Partial<
  Record<SnapshotPresetMode, WeeklyTeamRow[]>
>;

export type TeamMembersWeeklyByPreset = Partial<
  Record<SnapshotPresetMode, TeamMemberWeeklyRow[]>
>;

export type DashboardSnapshot = {
  generatedAt: string;
  preset: PresetMode;
  presetLabel: string;
  summary: {
    totalRows: number;
    totalPropertySF: number;
    totalTime: number;
    avgDraftRate: number;
    avgQER: number;
    avgL1: number;
    avgL2: number;
    avgL3: number;
    qaFiles: number;
    qaPropertySF: number;
    qaTime: number;
    avgQARate: number;
  };
  teams: TeamComparisonRow[];
  teamComparisonByPreset?: TeamComparisonByPreset;
  teamMembersByPreset?: TeamMembersByPreset;
  weeklyTeamsByPreset?: WeeklyTeamsByPreset;
  teamMembersWeeklyByPreset?: TeamMembersWeeklyByPreset;
  weeklyRows: WeeklySummaryRow[];
  topDraftersByTeam: TeamLeaderRow[];
  topQaByTeam: TeamLeaderRow[];
  presetDistribution: PresetDistributionRow[];
};
