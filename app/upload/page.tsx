"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Papa, { ParseResult } from "papaparse";
import { parseScheduleWorkbook } from "@/lib/schedule/parse-xlsx";
import {
  readPersistedScheduleBatches,
  writePersistedScheduleBatches,
  clearPersistedScheduleBatches,
} from "@/lib/store/schedule-batches";
import type { ScheduleBatch } from "@/lib/schedule/schedule-types";
import {
  COL_10K as COL_10K_LIB,
  COL_DRAFTER_NAME as COL_DRAFTER_NAME_LIB,
  COL_DRAFTER_TEAM as COL_DRAFTER_TEAM_LIB,
  COL_IS_ADS as COL_IS_ADS_LIB,
  COL_QA_NAME as COL_QA_NAME_LIB,
  COL_QA_TEAM as COL_QA_TEAM_LIB,
  COL_TYPE as COL_TYPE_LIB,
  FOCUS_TEAMS as FOCUS_TEAMS_LIB,
} from "@/lib/presets/constants";
import {
  normalizeColumnKey as normalizeColumnKeyLib,
  normalizeToken as normalizeTokenLib,
  normalizeValue as normalizeValueLib,
  getField as getFieldLib,
  getRowLookup as getRowLookupLib,
  getStrictFieldByAliases as getStrictFieldByAliasesLib,
  hasColumnAlias as hasColumnAliasLib,
  hasIsAdsHeader as hasIsAdsHeaderLib,
  isLikelyErrorAdsHeader as isLikelyErrorAdsHeaderLib,
  looksLikeDateOrTimestamp as looksLikeDateOrTimestampLib,
} from "@/lib/csv/row-helpers";
import {
  getAdsBucket as getAdsBucketLib,
  getAdsBucketFromRow as getAdsBucketFromRowLib,
  getAdsSourceValue as getAdsSourceValueLib,
  getPropertySFValue as getPropertySFValueLib,
  getStrictAdsField as getStrictAdsFieldLib,
  getStrictTenKField as getStrictTenKFieldLib,
  getTenKBucket as getTenKBucketLib,
  getTenKBucketFromRow as getTenKBucketFromRowLib,
  getTenKSourceValue as getTenKSourceValueLib,
  getTypeBucket as getTypeBucketLib,
  isBlankLike as isBlankLikeLib,
} from "@/lib/presets/buckets";
import { matchesPreset as matchesPresetLib } from "@/lib/presets/matches-preset";
import { calculateQER as calculateQERLib } from "@/lib/metrics/qer";
import {
  getParseHeaders as getParseHeadersLib,
  getParseScore as getParseScoreLib,
  parseCsvFileWithDelimiter as parseCsvFileWithDelimiterLib,
} from "@/lib/csv/parser";
import {
  formatNumber as formatNumberLib,
  parseNumber as parseNumberLib,
  uniqueSorted as uniqueSortedLib,
} from "@/lib/format/number";
import {
  DASHBOARD_SNAPSHOT_EVENT,
  DASHBOARD_SNAPSHOT_KEY,
  type DashboardSnapshot,
  type PresetDistributionRow,
  type TeamMemberSnapshotRow,
  type TeamLeaderRow,
} from "@/lib/store/dashboard-snapshot";
import { persistRemoteDashboardState } from "@/lib/store/remote-dashboard-state";

type CsvRow = Record<string, string>;

type PresetMode =
  | "manual"
  | "combined"
  | "std"
  | "premium"
  | "ads_std"
  | "ads_prem"
  | "gt10k";

type Level = "Junior" | "Intermedio" | "Senior";
type PrimaryRole = "Drafter" | "QA" | "Updates";
type PersonFunction = "Draft" | "QA" | "Siteplans" | "Updates" | "Revit";

type PersonConfig = {
  level: Level;
  primaryRole: PrimaryRole;
  functions: PersonFunction[];
  isTeamLead?: boolean;
};

type DraftRow = {
  name: string;
  fileCount: number;
  propertySF: number;
  time: number;
  draftRate: number;
  qer: number;
  l1: number;
  l2: number;
  l3: number;
  isTotal?: boolean;
};

type QARow = {
  name: string;
  fileCount: number;
  propertySF: number;
  time: number;
  qaRate: number;
  qer: number;
  isTotal?: boolean;
};

type WeeklySummaryRow = {
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

type WeeklyTeamRow = {
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

type TeamMemberWeeklyRow = {
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

type MetricTone = "emerald" | "amber" | "rose" | "slate";
type UploadTarget = "standard" | "australia";

type PersonBreakdownRow = {
  preset: string;
  draftFiles: number;
  draftHours: number;
  draftRate: number;
  qer: number;
  l1: number;
  l2: number;
  l3: number;
  qaFiles: number;
  qaHours: number;
  qaRate: number;
};

type TeamComparisonRow = {
  team: string;
  draftFiles: number;
  draftHours: number;
  draftRate: number;
  qer: number;
  qaFiles: number;
  qaHours: number;
  qaRate: number;
};

type UploadedBatch = {
  id: string;
  fileName: string;
  uploadedAt: string;
  rowCount: number;
  rows: CsvRow[];
};

type PersistedUploadBatches = {
  standard: UploadedBatch[];
  australia: UploadedBatch[];
  updatedAt: string;
};

const COL_TYPE = COL_TYPE_LIB;
const COL_10K = COL_10K_LIB;
const COL_IS_ADS = COL_IS_ADS_LIB;
const COL_DRAFTER_TEAM = COL_DRAFTER_TEAM_LIB;
const COL_QA_TEAM = COL_QA_TEAM_LIB;
const COL_DRAFTER_NAME = COL_DRAFTER_NAME_LIB;
const COL_QA_NAME = COL_QA_NAME_LIB;
const FOCUS_TEAMS = FOCUS_TEAMS_LIB;

const isRrePodTeam = (team: string) => /^RRE[A-Z]{2,4}\d+$/i.test(String(team ?? "").trim());

type RowLookup = {
  normalizedEntries: Array<{ rowKey: string; normalized: string }>;
};

const rowLookupCache = new WeakMap<CsvRow, RowLookup>();
const rowDateCache = new WeakMap<CsvRow, Date | null>();

function parseNumber(value?: string): number {
  return parseNumberLib(value);
}

function formatNumber(value: number, decimals = 2) {
  return formatNumberLib(value, decimals);
}

function normalizeValue(value?: string) {
  return normalizeValueLib(value);
}

function normalizeToken(value?: string) {
  return normalizeTokenLib(value);
}

function uniqueSorted(values: string[]) {
  return uniqueSortedLib(values);
}

function normalizeColumnKey(value: string) {
  return normalizeColumnKeyLib(value);
}

function getRowLookup(row: CsvRow) {
  return getRowLookupLib(row);
}

function getField(row: CsvRow, keys: string[]) {
  return getFieldLib(row, keys);
}

function isLikelyErrorAdsHeader(header: string) {
  return isLikelyErrorAdsHeaderLib(header);
}

function looksLikeDateOrTimestamp(value?: string) {
  return looksLikeDateOrTimestampLib(value);
}

function getStrictFieldByAliases(row: CsvRow, aliases: string[]) {
  return getStrictFieldByAliasesLib(row, aliases);
}

function getStrictTenKField(row: CsvRow) {
  return getStrictTenKFieldLib(row);
}

function getStrictAdsField(row: CsvRow) {
  return getStrictAdsFieldLib(row);
}

function hasColumnAlias(headers: string[], aliases: string[]) {
  return hasColumnAliasLib(headers, aliases);
}

function hasIsAdsHeader(headers: string[]) {
  return hasIsAdsHeaderLib(headers);
}

function matchesTeamSelection(
  row: CsvRow,
  selectedTeams: string[],
  context: "draft" | "qa"
) {
  if (selectedTeams.length === 0) return true;

  const teamValue =
    context === "draft"
      ? normalizeValue(getField(row, COL_DRAFTER_TEAM))
      : normalizeValue(getField(row, COL_QA_TEAM));

  return selectedTeams.includes(teamValue);
}

function getParseHeaders(result: ParseResult<CsvRow>) {
  return getParseHeadersLib(result);
}

function getParseScore(result: ParseResult<CsvRow>) {
  return getParseScoreLib(result);
}

function parseDateCandidate(value?: string): Date | null {
  const token = normalizeValue(value);
  if (!token) return null;

  const isoMatch = token.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const dmyMatch = token.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const parsed = Date.parse(token.replace(",", " "));
  if (!Number.isNaN(parsed)) {
    const parsedDate = new Date(parsed);
    if (!Number.isNaN(parsedDate.getTime())) return parsedDate;
  }

  return null;
}

function getDateFromRow(row: CsvRow): Date | null {
  if (rowDateCache.has(row)) {
    return rowDateCache.get(row) ?? null;
  }

  const candidates: string[] = [];
  const pushCandidate = (value?: string) => {
    const normalized = normalizeValue(value);
    if (normalized) candidates.push(normalized);
  };

  pushCandidate(
    getStrictFieldByAliases(row, [
      "Publish Timestamp",
      "PublishTimestamp",
      "Publish Date",
      "PublishDate",
      "Date",
      "Created At",
      "CreatedAt",
      "Timestamp",
      "Time",
    ])
  );
  pushCandidate(
    getStrictFieldByAliases(row, [
      "File",
      "File Name",
      "Filename",
      "FileName",
    ])
  );

  const lookup = getRowLookup(row);
  for (const entry of lookup.normalizedEntries) {
    if (
      entry.normalized.includes("publishtimestamp") ||
      entry.normalized.includes("publishdate") ||
      entry.normalized === "date" ||
      entry.normalized.endsWith("timestamp")
    ) {
      pushCandidate(row[entry.rowKey]);
    }
  }

  for (const value of candidates) {
    const parsed = parseDateCandidate(value);
    if (parsed) {
      rowDateCache.set(row, parsed);
      return parsed;
    }
  }

  rowDateCache.set(row, null);
  return null;
}

function getMonday(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getSunday(date: Date) {
  const monday = getMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

function formatDate(date: Date) {
  return date.toLocaleDateString("es-CO");
}

function getISOWeek(date: Date) {
  const tmp = new Date(date.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((tmp.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7
    )
  );
}

function statusBadgeClass(status: string) {
  if (status === "OK" || status === "Cumple" || status === "Cumple target") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  }
  if (
    status === "Cerca" ||
    status === "Sobre mínimo" ||
    status === "Horas bajas"
  ) {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  }
  if (status === "Bajo" || status === "Alto" || status === "Fuera de límite") {
    return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  }
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function getStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isBlankLike(value?: string) {
  return isBlankLikeLib(value);
}

function getTypeBucket(value?: string) {
  return getTypeBucketLib(value);
}

function getTenKBucket(value?: string) {
  return getTenKBucketLib(value);
}

function getAdsBucket(value?: string) {
  return getAdsBucketLib(value);
  const token = normalizeToken(value);

  if (
    isBlankLike(value) ||
    ["no", "false", "non ads", "not ads"].includes(token)
  ) {
    return "blank";
  }
  if (
    ["ads", "si", "sí", "yes", "true"].includes(token) ||
    (token.includes("ads") &&
      !token.includes("no") &&
      !token.includes("non") &&
      !token.includes("not"))
  ) {
    return "ads";
  }

  return token;
}

function getPropertySFValue(row: CsvRow) {
  return getPropertySFValueLib(row);
}

function getTenKSourceValue(row: CsvRow) {
  return getTenKSourceValueLib(row);
}

function getAdsSourceValue(row: CsvRow) {
  return getAdsSourceValueLib(row);
}

function getTenKBucketFromRow(row: CsvRow) {
  return getTenKBucketFromRowLib(row);
}

function getAdsBucketFromRow(row: CsvRow) {
  return getAdsBucketFromRowLib(row);
}

function matchesPreset(
  row: CsvRow,
  mode: PresetMode
) {
  return matchesPresetLib(row, mode);
}

function calculateQER(qaMinutes: number, draftMinutes: number) {
  return calculateQERLib(qaMinutes, draftMinutes);
}

function getMetricToneClass(tone: MetricTone) {
  if (tone === "emerald") return statusBadgeClass("OK");
  if (tone === "amber") return statusBadgeClass("Cerca");
  if (tone === "rose") return statusBadgeClass("Bajo");
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function getDraftMetricTone(rate: number, level: Level, hours: number): MetricTone {
  if (hours <= 0) return "slate";
  if (hours < 15) return "amber";

  const target = LEVEL_TARGETS[level];

  if (rate >= target) return "emerald";
  if (rate >= target * 0.8) return "amber";
  return "rose";
}

function getQAMetricTone(rate: number, hours: number): MetricTone {
  if (hours <= 0) return "slate";
  if (hours < 15) return "amber";

  if (rate >= QA_TARGET_MIN && rate <= QA_TARGET_MAX) return "emerald";
  if (rate >= QA_TARGET_MIN * 0.8) return "amber";
  return "rose";
}

function getQERTone(qer: number): MetricTone {
  if (qer <= 0) return "slate";
  if (qer <= 10) return "emerald";
  if (qer <= 18) return "amber";
  return "rose";
}

function getErrorTone(value: number): MetricTone {
  if (value <= 1) return "emerald";
  if (value <= 2) return "amber";
  return "rose";
}

const LEVEL_TARGETS: Record<Level, number> = {
  Junior: 2500,
  Intermedio: 3500,
  Senior: 4500,
};

const QA_TARGET_MIN = 8000;
const QA_TARGET_MAX = 11000;
const STORAGE_VERSION_KEY = "metric-planitar-storage-version";
const STORAGE_VERSION = "2026-04-01-v3";
const STANDARD_BATCHES_KEY = "metric-planitar-standard-batches";
const AUSTRALIA_BATCHES_KEY = "metric-planitar-australia-batches";
const UPLOAD_BATCHES_DB_NAME = "metric-planitar-upload-db";
const UPLOAD_BATCHES_DB_VERSION = 1;
const UPLOAD_BATCHES_STORE = "upload-batches";
const UPLOAD_BATCHES_RECORD_KEY = "weekly-history";

function isQuotaExceededError(error: unknown) {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22
  );
}

function removeLegacyBatchStorageKeys() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STANDARD_BATCHES_KEY);
  localStorage.removeItem(AUSTRALIA_BATCHES_KEY);
}

function safeSetLocalStorage(key: string, value: string) {
  if (typeof window === "undefined") return false;

  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      try {
        removeLegacyBatchStorageKeys();
        localStorage.setItem(key, value);
        return true;
      } catch (retryError) {
        console.warn(
          `[MetricPlanitar] No se pudo guardar '${key}' por límite de almacenamiento.`,
          retryError
        );
        return false;
      }
    }

    console.warn(`[MetricPlanitar] No se pudo guardar '${key}' en localStorage.`, error);
    return false;
  }
}

function openUploadBatchesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB no está disponible en este navegador."));
      return;
    }

    const request = window.indexedDB.open(UPLOAD_BATCHES_DB_NAME, UPLOAD_BATCHES_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UPLOAD_BATCHES_STORE)) {
        db.createObjectStore(UPLOAD_BATCHES_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

async function readUploadBatchesFromDb(): Promise<PersistedUploadBatches | null> {
  const db = await openUploadBatchesDb();

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_BATCHES_STORE, "readonly");
      const store = tx.objectStore(UPLOAD_BATCHES_STORE);
      const request = store.get(UPLOAD_BATCHES_RECORD_KEY);

      request.onsuccess = () => {
        const value = request.result as PersistedUploadBatches | undefined;
        resolve(value ?? null);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("No se pudo leer historial desde IndexedDB."));
    });
  } finally {
    db.close();
  }
}

async function writeUploadBatchesToDb(payload: PersistedUploadBatches) {
  const db = await openUploadBatchesDb();

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(UPLOAD_BATCHES_STORE, "readwrite");
      const store = tx.objectStore(UPLOAD_BATCHES_STORE);
      store.put(payload, UPLOAD_BATCHES_RECORD_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("No se pudo guardar historial en IndexedDB."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("La transacción de IndexedDB fue cancelada."));
    });
  } finally {
    db.close();
  }
}

function clearFilterStorage() {
  if (typeof window === "undefined") return;

  const keys = [
    "metric-planitar-selected-types",
    "metric-planitar-selected-10k",
    "metric-planitar-selected-ads",
    "metric-planitar-selected-teams",
    "metric-planitar-preset-mode",
  ];

  keys.forEach((key) => localStorage.removeItem(key));
}

const DEFAULT_PERSON_CONFIG: Record<string, PersonConfig> = {
  "Isabella Bernal Camargo": {
    level: "Junior",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Josue Ramirez": {
    level: "Junior",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Juan Pablo Castillo Acevedo": {
    level: "Junior",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Maria Fernanda Bello": {
    level: "Junior",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Johan Higuera": {
    level: "Intermedio",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Juan Amaya": {
    level: "Intermedio",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Juliana Becerra": {
    level: "Intermedio",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Mateo Pena": {
    level: "Intermedio",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Orlando Espitia": {
    level: "Intermedio",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Sandra Gutierrez": {
    level: "Intermedio",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Diego Franco": {
    level: "Senior",
    primaryRole: "Drafter",
    functions: ["Draft"],
  },
  "Jessy Claros": {
    level: "Senior",
    primaryRole: "QA",
    functions: ["QA"],
  },
  "Andrea Rico": {
    level: "Senior",
    primaryRole: "QA",
    functions: ["QA"],
  },
  "Juan Garces": {
    level: "Senior",
    primaryRole: "QA",
    functions: ["QA"],
  },
};

const ALL_FUNCTIONS: PersonFunction[] = [
  "Draft",
  "QA",
  "Siteplans",
  "Updates",
  "Revit",
];

const PRESET_OPTIONS: Array<{
  key: Exclude<PresetMode, "manual">;
  label: string;
  description: string;
}> = [
  {
    key: "combined",
    label: "Combined",
    description:
      "Vista consolidada: incluye Draft, Draft Premium, trabajo below/blank/above y casos ADS.",
  },
  {
    key: "std",
    label: "Std",
    description:
      "Solo Standard: Type = draft, 10k = below + blank y ADS en blanco.",
  },
  {
    key: "premium",
    label: "Premium",
    description:
      "Solo Premium: Type = draft-premium, 10k = below + blank y ADS en blanco.",
  },
  {
    key: "ads_std",
    label: "ADS Std",
    description:
      "Solo ADS Standard: Type = draft, 10k = below e Is ADS = ADS.",
  },
  {
    key: "ads_prem",
    label: "ADS Prem",
    description:
      "Solo ADS Premium: Type = draft-premium, 10k = below e Is ADS = ADS.",
  },
  {
    key: "gt10k",
    label: ">10k",
    description:
      "Trabajo grande: Type = draft + draft-premium, 10k = above y ADS puede venir blank o ADS.",
  },
];

const DEFAULT_TEAM_LEADER_NAMES = [
  "Daniel Camilo Espejo Guzman",
  "Maria Vasques",
  "Maria Vasquez",
  "Sebastian Cuervo",
];
const DEBUG_UPLOAD_LOGS = false;
const SHOW_UPLOAD_ANALYTICS = false;

function withDefaultTeamLeads(
  config: Record<string, PersonConfig>
): Record<string, PersonConfig> {
  const next = { ...config };
  const leaderTokens = new Set(
    DEFAULT_TEAM_LEADER_NAMES.map((name) => normalizeValue(name))
  );

  Object.entries(next).forEach(([name, row]) => {
    if (leaderTokens.has(normalizeValue(name))) {
      next[name] = {
        ...row,
        isTeamLead: true,
      };
    }
  });

  return next;
}

export default function UploadPage() {
  const standardInputRef = useRef<HTMLInputElement | null>(null);
  const australiaInputRef = useRef<HTMLInputElement | null>(null);
  const lastSerializedSnapshotRef = useRef("");
  const lastSerializedCloudStateRef = useRef("");
  const skippedInitialBatchPersistRef = useRef(false);
  const lastPersistedBatchStampRef = useRef("");
  const [forceSnapshotRefresh, setForceSnapshotRefresh] = useState(false);

  const [standardBatches, setStandardBatches] = useState<UploadedBatch[]>([]);
  const [australiaBatches, setAustraliaBatches] = useState<UploadedBatch[]>([]);
  const [pendingStandardFiles, setPendingStandardFiles] = useState<File[]>([]);
  const [pendingAustraliaFiles, setPendingAustraliaFiles] = useState<File[]>([]);
  const [batchesStorageReady, setBatchesStorageReady] = useState(false);
  const [error, setError] = useState("");
  const [isProcessingUploads, setIsProcessingUploads] = useState(false);

  const scheduleInputRef = useRef<HTMLInputElement | null>(null);
  const [scheduleBatches, setScheduleBatches] = useState<ScheduleBatch[]>([]);
  const [scheduleProcessing, setScheduleProcessing] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleWarnings, setScheduleWarnings] = useState<string[]>([]);

  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedTenK, setSelectedTenK] = useState<string[]>([]);
  const [selectedAds, setSelectedAds] = useState<string[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [presetMode, setPresetMode] = useState<PresetMode>("combined");

  const [personConfig, setPersonConfig] = useState<Record<string, PersonConfig>>(
    withDefaultTeamLeads(DEFAULT_PERSON_CONFIG)
  );
  const [editingPersonKey, setEditingPersonKey] = useState<string | null>(null);
  const [detailPersonName, setDetailPersonName] = useState<string | null>(null);

  const shouldComputeAnalytics = SHOW_UPLOAD_ANALYTICS || forceSnapshotRefresh;

  const standardRowCount = useMemo(() => {
    return standardBatches.reduce((sum, batch) => sum + batch.rowCount, 0);
  }, [standardBatches]);

  const australiaRowCount = useMemo(() => {
    return australiaBatches.reduce((sum, batch) => sum + batch.rowCount, 0);
  }, [australiaBatches]);

  const standardData = useMemo(() => {
    if (!shouldComputeAnalytics) return [] as CsvRow[];
    return standardBatches.flatMap((batch) => batch.rows);
  }, [standardBatches, shouldComputeAnalytics]);

  const australiaData = useMemo(() => {
    if (!shouldComputeAnalytics) return [] as CsvRow[];
    return australiaBatches.flatMap((batch) => batch.rows);
  }, [australiaBatches, shouldComputeAnalytics]);

  const standardFile = standardBatches[standardBatches.length - 1]?.fileName ?? "";
  const australiaFile = australiaBatches[australiaBatches.length - 1]?.fileName ?? "";

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const url = new URL(window.location.href);
    const shouldForceFresh = url.searchParams.has("fresh");
    const savedVersion = localStorage.getItem(STORAGE_VERSION_KEY);

    if (shouldForceFresh || savedVersion !== STORAGE_VERSION) {
      clearFilterStorage();
      safeSetLocalStorage(STORAGE_VERSION_KEY, STORAGE_VERSION);
    }

    let isCancelled = false;

    const loadBatches = async () => {
      try {
        const persisted = await readUploadBatchesFromDb();
        if (!isCancelled && persisted) {
          setStandardBatches(persisted.standard ?? []);
          setAustraliaBatches(persisted.australia ?? []);
        } else if (!isCancelled) {
          const legacyStandard = getStorage<UploadedBatch[]>(STANDARD_BATCHES_KEY, []);
          const legacyAustralia = getStorage<UploadedBatch[]>(AUSTRALIA_BATCHES_KEY, []);

          setStandardBatches(legacyStandard);
          setAustraliaBatches(legacyAustralia);

          if (legacyStandard.length > 0 || legacyAustralia.length > 0) {
            await writeUploadBatchesToDb({
              standard: legacyStandard,
              australia: legacyAustralia,
              updatedAt: new Date().toISOString(),
            });
            removeLegacyBatchStorageKeys();
          }
        }
      } catch (dbError) {
        console.warn(
          "[MetricPlanitar] No se pudo leer IndexedDB, usando fallback de localStorage.",
          dbError
        );
        if (!isCancelled) {
          setStandardBatches(getStorage<UploadedBatch[]>(STANDARD_BATCHES_KEY, []));
          setAustraliaBatches(getStorage<UploadedBatch[]>(AUSTRALIA_BATCHES_KEY, []));
        }
      } finally {
        if (!isCancelled) {
          setBatchesStorageReady(true);
        }
      }
    };

    void loadBatches();

    void (async () => {
      try {
        const persisted = await readPersistedScheduleBatches();
        if (!isCancelled) {
          setScheduleBatches(persisted.batches ?? []);
        }
      } catch {
        if (!isCancelled) setScheduleBatches([]);
      }
    })();

    setPersonConfig(
      withDefaultTeamLeads(
        getStorage<Record<string, PersonConfig>>(
        "metric-planitar-person-config",
        DEFAULT_PERSON_CONFIG
      )
      )
    );
    setSelectedTypes(getStorage<string[]>("metric-planitar-selected-types", []));
    setSelectedTenK(getStorage<string[]>("metric-planitar-selected-10k", []));
    setSelectedAds(getStorage<string[]>("metric-planitar-selected-ads", []));
    setSelectedTeams(getStorage<string[]>("metric-planitar-selected-teams", []));
    setPresetMode(getStorage<PresetMode>("metric-planitar-preset-mode", "combined"));

    return () => {
      isCancelled = true;
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    safeSetLocalStorage(
      "metric-planitar-person-config",
      JSON.stringify(personConfig)
    );
    window.dispatchEvent(new Event("metric-planitar-person-config-updated"));
  }, [personConfig]);

  useEffect(() => {
    if (!batchesStorageReady) return;

    const persistenceStamp = [
      standardBatches.length,
      standardBatches[standardBatches.length - 1]?.id ?? "",
      australiaBatches.length,
      australiaBatches[australiaBatches.length - 1]?.id ?? "",
    ].join("|");

    if (!skippedInitialBatchPersistRef.current) {
      skippedInitialBatchPersistRef.current = true;
      lastPersistedBatchStampRef.current = persistenceStamp;
      return;
    }

    if (lastPersistedBatchStampRef.current === persistenceStamp) {
      return;
    }

    lastPersistedBatchStampRef.current = persistenceStamp;

    let isCancelled = false;

    const persist = async () => {
      try {
        await writeUploadBatchesToDb({
          standard: standardBatches,
          australia: australiaBatches,
          updatedAt: new Date().toISOString(),
        });
      } catch (dbError) {
        console.error("[MetricPlanitar] Error guardando batches en IndexedDB.", dbError);
        if (!isCancelled) {
          setError(
            "No se pudo guardar el historial semanal en tu navegador. Exporta o limpia historial para continuar."
          );
        }
      }
    };

    void persist();

    return () => {
      isCancelled = true;
    };
  }, [batchesStorageReady, standardBatches, australiaBatches]);

  useEffect(() => {
    safeSetLocalStorage("metric-planitar-selected-types", JSON.stringify(selectedTypes));
  }, [selectedTypes]);

  useEffect(() => {
    safeSetLocalStorage("metric-planitar-selected-10k", JSON.stringify(selectedTenK));
  }, [selectedTenK]);

  useEffect(() => {
    safeSetLocalStorage("metric-planitar-selected-ads", JSON.stringify(selectedAds));
  }, [selectedAds]);

  useEffect(() => {
    safeSetLocalStorage("metric-planitar-selected-teams", JSON.stringify(selectedTeams));
  }, [selectedTeams]);

  useEffect(() => {
    safeSetLocalStorage("metric-planitar-preset-mode", JSON.stringify(presetMode));
  }, [presetMode]);

  function logParsedColumnDebug(
    rows: CsvRow[],
    headers: string[],
    source: string
  ) {
    if (!DEBUG_UPLOAD_LOGS) return;

    const strictTenKValues = Array.from(
      new Set(rows.map((row) => getStrictTenKField(row)).filter((value) => value !== ""))
    ).slice(0, 20);

    const strictAdsValues = Array.from(
      new Set(rows.map((row) => getStrictAdsField(row)).filter((value) => value !== ""))
    ).slice(0, 20);

    const typeValues = Array.from(
      new Set(
        rows
          .map((row) => normalizeValue(getField(row, COL_TYPE)))
          .filter((value) => value !== "")
      )
    ).slice(0, 20);

    console.log(`[MetricPlanitar][parse-debug][${source}] headers`, headers);
    console.log(
      `[MetricPlanitar][parse-debug][${source}] strict 10k values`,
      strictTenKValues
    );
    console.log(
      `[MetricPlanitar][parse-debug][${source}] strict ADS values`,
      strictAdsValues
    );
    console.log(
      `[MetricPlanitar][parse-debug][${source}] type values`,
      typeValues
    );
  }

  function guessDelimiterCandidates(rawText: string) {
    const candidates: Array<";" | "," | "\t"> = [";", ",", "\t"];
    const scores = new Map<string, number>(candidates.map((delimiter) => [delimiter, 0]));
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 30);

    for (const line of lines) {
      for (const delimiter of candidates) {
        const parts = line.split(delimiter);
        if (parts.length <= 1) continue;
        const nonEmptyParts = parts.filter((part) => normalizeValue(part).length > 0).length;
        const current = scores.get(delimiter) ?? 0;
        scores.set(delimiter, current + nonEmptyParts);
      }
    }

    const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    const ordered = sorted.map(([delimiter]) => delimiter as ";" | "," | "\t");
    return ordered.length > 0 ? ordered : candidates;
  }

  const handleFile = async (file: File): Promise<CsvRow[]> => {
    setError("");
    const sampleText = await file.slice(0, 256 * 1024).text();

    const delimiters = guessDelimiterCandidates(sampleText);
    let bestResult: ParseResult<CsvRow> | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const delimiter of delimiters) {
      try {
        const result = await parseCsvFileWithDelimiterLib(file, delimiter);
        const score = getParseScore(result);

        if (score > bestScore) {
          bestScore = score;
          bestResult = result;
        }

        if (score >= 30 && result.data && result.data.length > 0) {
          break;
        }
      } catch (err) {
        console.error(err);
      }
    }

    if (bestResult && bestResult.data && bestResult.data.length > 0) {
      logParsedColumnDebug(
        bestResult.data,
        getParseHeaders(bestResult),
        `${file.name}:best`
      );
      return bestResult.data;
    }

    return new Promise((resolve) => {
      Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      worker: true,
      complete: (results: ParseResult<CsvRow>) => {
        if (!results.data || results.data.length === 0) {
          setError("El archivo no tiene filas válidas.");
          resolve([]);
          return;
        }
        logParsedColumnDebug(
          results.data,
          getParseHeaders(results),
          `${file.name}:fallback`
        );
        resolve(results.data);
      },
      error: (err) => {
        console.error(err);
        setError("Error leyendo el archivo CSV.");
        resolve([]);
      },
      });
    });
  };

  function resetFiltersForNewData() {
    setPresetMode("combined");
    setSelectedTypes([]);
    setSelectedTenK([]);
    setSelectedAds([]);
    setSelectedTeams([]);
    setEditingPersonKey(null);
    setDetailPersonName(null);
  }

  async function appendFilesToHistory(target: UploadTarget, files: File[]) {
    if (files.length === 0) return;

    try {
      setIsProcessingUploads(true);
      setError("");
      resetFiltersForNewData();

      const batches: UploadedBatch[] = [];
      for (const file of files) {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        const rows = await handleFile(file);
        if (rows.length === 0) continue;

        batches.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          rowCount: rows.length,
          rows,
        });
      }

      if (batches.length > 0) {
        if (target === "standard") {
          setStandardBatches((prev) => [...prev, ...batches]);
        } else {
          setAustraliaBatches((prev) => [...prev, ...batches]);
        }
        setForceSnapshotRefresh(true);
      } else {
        setError("No se pudieron agregar filas con los archivos seleccionados.");
      }
    } finally {
      const input =
        target === "standard" ? standardInputRef.current : australiaInputRef.current;
      if (input) {
        input.value = "";
      }
      setIsProcessingUploads(false);
    }
  }

  function clearUploadHistory() {
    setStandardBatches([]);
    setAustraliaBatches([]);
    setPendingStandardFiles([]);
    setPendingAustraliaFiles([]);
    setError("");
    resetFiltersForNewData();
    setForceSnapshotRefresh(true);

    if (typeof window !== "undefined") {
      localStorage.removeItem(DASHBOARD_SNAPSHOT_KEY);
      lastSerializedSnapshotRef.current = "";
      lastSerializedCloudStateRef.current = "";
      window.dispatchEvent(new Event(DASHBOARD_SNAPSHOT_EVENT));
    }

    void persistRemoteDashboardState({
      snapshot: null,
      batches: {
        standard: [],
        australia: [],
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  async function openNativeFilePicker(target: UploadTarget) {
    const input =
      target === "standard" ? standardInputRef.current : australiaInputRef.current;

    if (!input) {
      setError("No fue posible abrir el selector de archivos.");
      return;
    }

    try {
      input.value = "";
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          input.click();
        });
      } else {
        input.click();
      }
    } catch {
      setError("No fue posible abrir el selector de archivos.");
    }
  }

  function handleInputSelection(
    target: UploadTarget,
    fileList: FileList | null
  ) {
    const files = fileList ? Array.from(fileList) : [];
    if (target === "standard") {
      setPendingStandardFiles(files);
    } else {
      setPendingAustraliaFiles(files);
    }
  }

  async function handleScheduleFile(file: File | null) {
    if (!file) return;
    setScheduleError("");
    setScheduleWarnings([]);
    setScheduleProcessing(true);
    try {
      const yearFromName = file.name.match(/\b(20\d{2})\b/);
      const defaultYear = yearFromName ? Number(yearFromName[1]) : new Date().getFullYear();
      const result = await parseScheduleWorkbook(file, { defaultYear });
      const persisted = await readPersistedScheduleBatches();
      const nextBatches = [...(persisted.batches ?? []), result.batch];
      await writePersistedScheduleBatches({
        batches: nextBatches,
        updatedAt: new Date().toISOString(),
      });
      setScheduleBatches(nextBatches);
      setScheduleWarnings(result.warnings);
    } catch (err) {
      console.error("[schedule]", err);
      setScheduleError(err instanceof Error ? err.message : "Error al procesar el archivo");
    } finally {
      setScheduleProcessing(false);
      if (scheduleInputRef.current) scheduleInputRef.current.value = "";
    }
  }

  async function clearScheduleHistory() {
    await clearPersistedScheduleBatches();
    setScheduleBatches([]);
    setScheduleError("");
    setScheduleWarnings([]);
  }

  async function processSelectedInputs() {
    setError("");

    if (pendingStandardFiles.length === 0 && pendingAustraliaFiles.length === 0) {
      setError("Selecciona al menos un archivo CSV para procesar.");
      return;
    }

    if (pendingStandardFiles.length > 0) {
      await appendFilesToHistory("standard", pendingStandardFiles);
      setPendingStandardFiles([]);
    }

    if (pendingAustraliaFiles.length > 0) {
      await appendFilesToHistory("australia", pendingAustraliaFiles);
      setPendingAustraliaFiles([]);
    }
  }

  const combinedData = useMemo(() => {
    return [...standardData, ...australiaData];
  }, [standardData, australiaData]);

  const analyticsData = useMemo(() => {
    if (!shouldComputeAnalytics) return [] as CsvRow[];
    return combinedData;
  }, [combinedData, shouldComputeAnalytics]);

  const uniqueTypes = useMemo(() => {
    return uniqueSorted(
      analyticsData.map((row) => getTypeBucket(getField(row, COL_TYPE)))
    );
  }, [analyticsData]);

  const uniqueTenK = useMemo(() => {
    return uniqueSorted(analyticsData.map((row) => getTenKBucketFromRow(row)));
  }, [analyticsData]);

  const uniqueAds = useMemo(() => {
    return uniqueSorted(analyticsData.map((row) => getAdsBucketFromRow(row)));
  }, [analyticsData]);

  const uniqueTeams = useMemo(() => {
    return uniqueSorted(
      analyticsData.flatMap((row) => [
        normalizeValue(getField(row, COL_DRAFTER_TEAM)),
        normalizeValue(getField(row, COL_QA_TEAM)),
      ])
    );
  }, [analyticsData]);

  const teamLeadNames = useMemo(() => {
    const fromConfig = Object.entries(personConfig)
      .filter(([, config]) => config.isTeamLead === true)
      .map(([name]) => normalizeValue(name))
      .filter((name) => name !== "");

    const fromDefaults = DEFAULT_TEAM_LEADER_NAMES.map((name) => normalizeValue(name));

    return new Set(
      [...fromConfig, ...fromDefaults]
        .filter((name) => name !== "")
    );
  }, [personConfig]);

  useEffect(() => {
    setSelectedTypes((prev) => prev.filter((value) => uniqueTypes.includes(value)));
  }, [uniqueTypes]);

  useEffect(() => {
    setSelectedTenK((prev) => {
      const normalized = prev.map((value) => getTenKBucket(value));
      return normalized.filter((value, index) => {
        return normalized.indexOf(value) === index && uniqueTenK.includes(value);
      });
    });
  }, [uniqueTenK]);

  useEffect(() => {
    setSelectedAds((prev) => {
      const normalized = prev.map((value) => getAdsBucket(value));
      return normalized.filter((value, index) => {
        return normalized.indexOf(value) === index && uniqueAds.includes(value);
      });
    });
  }, [uniqueAds]);

  useEffect(() => {
    setSelectedTeams((prev) => prev.filter((value) => uniqueTeams.includes(value)));
  }, [uniqueTeams]);

  const filteredDraftData = useMemo(() => {
    return analyticsData.filter((row) => {
      const rowType = getTypeBucket(getField(row, COL_TYPE));
      const rowTenK = getTenKBucketFromRow(row);
      const rowAds = getAdsBucketFromRow(row);
      const drafterName = normalizeValue(getField(row, COL_DRAFTER_NAME));

      const typeOk =
        selectedTypes.length === 0 || selectedTypes.includes(rowType);

      const tenKOk =
        selectedTenK.length === 0 || selectedTenK.includes(rowTenK);

      const adsOk =
        selectedAds.length === 0 || selectedAds.includes(rowAds);

      const teamOk = matchesTeamSelection(row, selectedTeams, "draft");
      const teamLeadOk = drafterName === "" || !teamLeadNames.has(drafterName);

      return (
        matchesPreset(row, presetMode) &&
        typeOk &&
        tenKOk &&
        adsOk &&
        teamOk &&
        teamLeadOk
      );
    });
  }, [
    analyticsData,
    presetMode,
    selectedTypes,
    selectedTenK,
    selectedAds,
    selectedTeams,
    teamLeadNames,
  ]);

  const filteredQAData = useMemo(() => {
    return analyticsData.filter((row) => {
      const rowType = getTypeBucket(getField(row, COL_TYPE));
      const rowTenK = getTenKBucketFromRow(row);
      const rowAds = getAdsBucketFromRow(row);
      const qaName = normalizeValue(getField(row, COL_QA_NAME));
      const qaMinutes = parseNumber(
        getField(row, ["QA Time (D)", "QA Time"])
      );

      const typeOk =
        selectedTypes.length === 0 || selectedTypes.includes(rowType);

      const tenKOk =
        selectedTenK.length === 0 || selectedTenK.includes(rowTenK);

      const adsOk =
        selectedAds.length === 0 || selectedAds.includes(rowAds);

      const teamOk = matchesTeamSelection(row, selectedTeams, "qa");
      const teamLeadOk = qaName === "" || !teamLeadNames.has(qaName);

      return (
        matchesPreset(row, presetMode) &&
        typeOk &&
        tenKOk &&
        adsOk &&
        teamOk &&
        teamLeadOk &&
        qaName !== "" &&
        qaMinutes > 0
      );
    });
  }, [
    analyticsData,
    presetMode,
    selectedTypes,
    selectedTenK,
    selectedAds,
    selectedTeams,
    teamLeadNames,
  ]);

  useEffect(() => {
    if (!DEBUG_UPLOAD_LOGS) return;

    console.log("[MetricPlanitar][filters-debug]", {
      presetMode,
      selectedTypes,
      selectedTenK,
      selectedAds,
      combinedData: analyticsData.length,
      filteredDraftData: filteredDraftData.length,
      filteredQAData: filteredQAData.length,
    });
  }, [
    presetMode,
    selectedTypes,
    selectedTenK,
    selectedAds,
    analyticsData.length,
    filteredDraftData.length,
    filteredQAData.length,
  ]);

  const draftAggregates = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        fileCount: number;
        propertySF: number;
        draftMinutes: number;
        qaMinutes: number;
        l1Total: number;
        l2Total: number;
        l3Total: number;
        rows: number;
      }
    >();

    filteredDraftData.forEach((row) => {
      const name = normalizeValue(getField(row, COL_DRAFTER_NAME));
      if (!name) return;

      if (!map.has(name)) {
        map.set(name, {
          name,
          fileCount: 0,
          propertySF: 0,
          draftMinutes: 0,
          qaMinutes: 0,
          l1Total: 0,
          l2Total: 0,
          l3Total: 0,
          rows: 0,
        });
      }

      const current = map.get(name)!;

      const sf = parseNumber(
        getField(row, ["Property SF (A)", "Property SF"])
      );

      const draftMinutes = parseNumber(
        getField(row, ["Draft Time (C)", "Draft Time"])
      );

      const qaMinutes = parseNumber(
        getField(row, ["QA Time (D)", "QA Time"])
      );

      const l1Raw = parseNumber(getField(row, ["L1 Errors", "L1/1000"]));
      const l2Raw = parseNumber(getField(row, ["L2 Errors", "L2/1000"]));
      const l3Raw = parseNumber(getField(row, ["L3 Errors", "L3/1000"]));

      current.fileCount += 1;
      current.propertySF += sf;
      current.draftMinutes += draftMinutes;
      current.qaMinutes += qaMinutes;
      current.l1Total += l1Raw;
      current.l2Total += l2Raw;
      current.l3Total += l3Raw;
      current.rows += 1;
    });

    return Array.from(map.values());
  }, [filteredDraftData]);

  const qaAggregates = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        fileCount: number;
        propertySF: number;
        draftMinutes: number;
        qaMinutes: number;
      }
    >();

    filteredQAData.forEach((row) => {
      const name = normalizeValue(getField(row, COL_QA_NAME));
      if (!name) return;

      if (!map.has(name)) {
        map.set(name, {
          name,
          fileCount: 0,
          propertySF: 0,
          draftMinutes: 0,
          qaMinutes: 0,
        });
      }

      const current = map.get(name)!;

      current.fileCount += 1;
      current.propertySF += parseNumber(
        getField(row, ["Property SF (A)", "Property SF"])
      );
      current.draftMinutes += parseNumber(
        getField(row, ["Draft Time (C)", "Draft Time"])
      );
      current.qaMinutes += parseNumber(
        getField(row, ["QA Time (D)", "QA Time"])
      );
    });

    return Array.from(map.values());
  }, [filteredQAData]);

  const rankingDrafters = useMemo<DraftRow[]>(() => {
    return draftAggregates
      .map((item) => {
        const draftHours = item.draftMinutes / 60;
        const draftRate = draftHours > 0 ? item.propertySF / draftHours : 0;
        const qer = calculateQER(item.qaMinutes, item.draftMinutes);
        const l1 = item.rows > 0 ? item.l1Total / item.rows : 0;
        const l2 = item.rows > 0 ? item.l2Total / item.rows : 0;
        const l3 = item.rows > 0 ? item.l3Total / item.rows : 0;

        return {
          name: item.name,
          fileCount: item.fileCount,
          propertySF: item.propertySF,
          time: draftHours,
          draftRate,
          qer,
          l1,
          l2,
          l3,
        };
      })
      .sort((a, b) => {
        if (b.draftRate !== a.draftRate) return b.draftRate - a.draftRate;
        if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
        return a.name.localeCompare(b.name);
      });
  }, [draftAggregates]);

  const rankingQA = useMemo<QARow[]>(() => {
    return qaAggregates
      .map((item) => {
        const hours = item.qaMinutes / 60;
        const qaRate = hours > 0 ? item.propertySF / hours : 0;

        return {
          name: item.name,
          fileCount: item.fileCount,
          propertySF: item.propertySF,
          time: hours,
          qaRate,
          qer: calculateQER(item.qaMinutes, item.draftMinutes),
        };
      })
      .sort((a, b) => {
        if (b.qaRate !== a.qaRate) return b.qaRate - a.qaRate;
        if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
        return a.name.localeCompare(b.name);
      });
  }, [qaAggregates]);

  const summary = useMemo(() => {
    const totalRows = draftAggregates.reduce(
      (sum, row) => sum + row.fileCount,
      0
    );
    const totalPropertySF = draftAggregates.reduce(
      (sum, row) => sum + row.propertySF,
      0
    );
    const totalDraftMinutes = draftAggregates.reduce(
      (sum, row) => sum + row.draftMinutes,
      0
    );
    const totalReviewQaMinutes = draftAggregates.reduce(
      (sum, row) => sum + row.qaMinutes,
      0
    );
    const totalTime = totalDraftMinutes / 60;
    const avgDraftRate = totalTime > 0 ? totalPropertySF / totalTime : 0;
    const avgQER = calculateQER(totalReviewQaMinutes, totalDraftMinutes);

    const totalL1 = draftAggregates.reduce((sum, row) => sum + row.l1Total, 0);
    const totalL2 = draftAggregates.reduce((sum, row) => sum + row.l2Total, 0);
    const totalL3 = draftAggregates.reduce((sum, row) => sum + row.l3Total, 0);

    const avgL1 = totalRows > 0 ? totalL1 / totalRows : 0;
    const avgL2 = totalRows > 0 ? totalL2 / totalRows : 0;
    const avgL3 = totalRows > 0 ? totalL3 / totalRows : 0;

    const qaFiles = qaAggregates.reduce((sum, row) => sum + row.fileCount, 0);
    const qaPropertySF = qaAggregates.reduce(
      (sum, row) => sum + row.propertySF,
      0
    );
    const totalQaMinutes = qaAggregates.reduce(
      (sum, row) => sum + row.qaMinutes,
      0
    );
    const qaTime = totalQaMinutes / 60;
    const avgQARate = qaTime > 0 ? qaPropertySF / qaTime : 0;

    return {
      totalRows,
      totalPropertySF,
      totalTime,
      avgDraftRate,
      avgQER,
      avgL1,
      avgL2,
      avgL3,
      qaFiles,
      qaPropertySF,
      qaTime,
      avgQARate,
    };
  }, [draftAggregates, qaAggregates]);

  const draftGrandTotal = useMemo<DraftRow>(() => {
    return {
      name: "Grand Total",
      fileCount: summary.totalRows,
      propertySF: summary.totalPropertySF,
      time: summary.totalTime,
      draftRate: summary.avgDraftRate,
      qer: summary.avgQER,
      l1: summary.avgL1,
      l2: summary.avgL2,
      l3: summary.avgL3,
      isTotal: true,
    };
  }, [summary]);

  const qaGrandTotal = useMemo<QARow>(() => {
    return {
      name: "Grand Total",
      fileCount: summary.qaFiles,
      propertySF: summary.qaPropertySF,
      time: summary.qaTime,
      qaRate: summary.avgQARate,
      qer: summary.avgQER,
      isTotal: true,
    };
  }, [summary]);

  const weeklySummary = useMemo<WeeklySummaryRow[]>(() => {
    const map = new Map<
      string,
      {
        weekLabel: string;
        firstDay: string;
        lastDay: string;
        fileCount: number;
        propertySF: number;
        draftMinutes: number;
        reviewQaMinutes: number;
        l1Total: number;
        l2Total: number;
        l3Total: number;
        rows: number;
        qaFiles: number;
        qaPropertySF: number;
        qaMinutes: number;
        sortDate: number;
      }
    >();

    filteredDraftData.forEach((row) => {
      const date = getDateFromRow(row);
      if (!date) return;

      const monday = getMonday(date);
      const sunday = getSunday(date);
      const key = monday.toISOString().slice(0, 10);

      if (!map.has(key)) {
        map.set(key, {
          weekLabel: `Week ${getISOWeek(date)}`,
          firstDay: formatDate(monday),
          lastDay: formatDate(sunday),
          fileCount: 0,
          propertySF: 0,
          draftMinutes: 0,
          reviewQaMinutes: 0,
          l1Total: 0,
          l2Total: 0,
          l3Total: 0,
          rows: 0,
          qaFiles: 0,
          qaPropertySF: 0,
          qaMinutes: 0,
          sortDate: monday.getTime(),
        });
      }

      const current = map.get(key)!;

      const sf = parseNumber(
        getField(row, ["Property SF (A)", "Property SF"])
      );
      const draftMinutes = parseNumber(
        getField(row, ["Draft Time (C)", "Draft Time"])
      );
      const qaMinutes = parseNumber(
        getField(row, ["QA Time (D)", "QA Time"])
      );

      current.fileCount += 1;
      current.propertySF += sf;
      current.draftMinutes += draftMinutes;
      current.reviewQaMinutes += qaMinutes;
      current.l1Total += parseNumber(getField(row, ["L1 Errors", "L1/1000"]));
      current.l2Total += parseNumber(getField(row, ["L2 Errors", "L2/1000"]));
      current.l3Total += parseNumber(getField(row, ["L3 Errors", "L3/1000"]));
      current.rows += 1;
    });

    filteredQAData.forEach((row) => {
      const date = getDateFromRow(row);
      if (!date) return;

      const monday = getMonday(date);
      const key = monday.toISOString().slice(0, 10);

      if (!map.has(key)) return;

      const current = map.get(key)!;

      current.qaFiles += 1;
      current.qaPropertySF += parseNumber(
        getField(row, ["Property SF (A)", "Property SF"])
      );
      current.qaMinutes += parseNumber(
        getField(row, ["QA Time (D)", "QA Time"])
      );
    });

    return Array.from(map.values())
      .sort((a, b) => a.sortDate - b.sortDate)
      .map((item) => {
        const draftHours = item.draftMinutes / 60;
        const qaHours = item.qaMinutes / 60;

        return {
          weekLabel: item.weekLabel,
          firstDay: item.firstDay,
          lastDay: item.lastDay,
          fileCount: item.fileCount,
          propertySF: item.propertySF,
          time: draftHours,
          avgDraftRate: draftHours > 0 ? item.propertySF / draftHours : 0,
          avgQER: calculateQER(item.reviewQaMinutes, item.draftMinutes),
          avgL1: item.rows > 0 ? item.l1Total / item.rows : 0,
          avgL2: item.rows > 0 ? item.l2Total / item.rows : 0,
          avgL3: item.rows > 0 ? item.l3Total / item.rows : 0,
          qaFiles: item.qaFiles,
          qaPropertySF: item.qaPropertySF,
          qaTime: qaHours,
          avgQARate: qaHours > 0 ? item.qaPropertySF / qaHours : 0,
        };
      });
  }, [
    filteredDraftData,
    filteredQAData,
  ]);

  const weeklyGrandTotal = useMemo<WeeklySummaryRow>(() => {
    return {
      weekLabel: "Grand Total",
      firstDay: "",
      lastDay: "",
      fileCount: summary.totalRows,
      propertySF: summary.totalPropertySF,
      time: summary.totalTime,
      avgDraftRate: summary.avgDraftRate,
      avgQER: summary.avgQER,
      avgL1: summary.avgL1,
      avgL2: summary.avgL2,
      avgL3: summary.avgL3,
      qaFiles: summary.qaFiles,
      qaPropertySF: summary.qaPropertySF,
      qaTime: summary.qaTime,
      avgQARate: summary.avgQARate,
      isTotal: true,
    };
  }, [summary]);

  const draftRowsWithTotal = useMemo(() => {
    return summary.totalRows > 0
      ? [...rankingDrafters, draftGrandTotal]
      : rankingDrafters;
  }, [draftGrandTotal, rankingDrafters, summary.totalRows]);

  const qaRowsWithTotal = useMemo(() => {
    return summary.qaFiles > 0 ? [...rankingQA, qaGrandTotal] : rankingQA;
  }, [qaGrandTotal, rankingQA, summary.qaFiles]);

  const weeklyRowsWithTotal = useMemo(() => {
    return summary.totalRows > 0 || summary.qaFiles > 0
      ? [...weeklySummary, weeklyGrandTotal]
      : weeklySummary;
  }, [summary.qaFiles, summary.totalRows, weeklyGrandTotal, weeklySummary]);

  function buildTeamComparisonRows(
    draftSource: CsvRow[],
    qaSource: CsvRow[]
  ): TeamComparisonRow[] {
    const teams = Array.from(
      new Set(
        [
          ...draftSource.map((row) => normalizeValue(getField(row, COL_DRAFTER_TEAM))),
          ...qaSource.map((row) => normalizeValue(getField(row, COL_QA_TEAM))),
        ]
          .filter((team) => team !== "")
          .filter((team) => isRrePodTeam(team))
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    return teams.map((team) => {
      const draftRows = draftSource.filter((row) => {
        return (
          normalizeValue(getField(row, COL_DRAFTER_TEAM)) === team &&
          normalizeValue(getField(row, COL_DRAFTER_NAME)) !== ""
        );
      });

      const draftSqft = draftRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["Property SF (A)", "Property SF"])),
        0
      );
      const draftMinutes = draftRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["Draft Time (C)", "Draft Time"])),
        0
      );
      const reviewQaMinutes = draftRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["QA Time (D)", "QA Time"])),
        0
      );

      const qaRows = qaSource.filter((row) => {
        return (
          normalizeValue(getField(row, COL_QA_TEAM)) === team &&
          normalizeValue(getField(row, COL_QA_NAME)) !== "" &&
          parseNumber(getField(row, ["QA Time (D)", "QA Time"])) > 0
        );
      });

      const qaSqft = qaRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["Property SF (A)", "Property SF"])),
        0
      );
      const qaMinutes = qaRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["QA Time (D)", "QA Time"])),
        0
      );

      const draftHours = draftMinutes / 60;
      const qaHours = qaMinutes / 60;

      return {
        team,
        draftFiles: draftRows.length,
        draftHours,
        draftRate: draftHours > 0 ? draftSqft / draftHours : 0,
        qer: calculateQER(reviewQaMinutes, draftMinutes),
        qaFiles: qaRows.length,
        qaHours,
        qaRate: qaHours > 0 ? qaSqft / qaHours : 0,
      };
    });
  }

  function buildWeeklyTeamRows(
    draftSource: CsvRow[],
    qaSource: CsvRow[]
  ): WeeklyTeamRow[] {
    const map = new Map<
      string,
      {
        team: string;
        weekLabel: string;
        firstDay: string;
        lastDay: string;
        draftFiles: number;
        draftSqft: number;
        draftMinutes: number;
        reviewQaMinutes: number;
        qaFiles: number;
        qaSqft: number;
        qaMinutes: number;
        sortDate: number;
      }
    >();

    const getOrCreate = (team: string, monday: Date, sunday: Date, label: string) => {
      const weekKey = monday.toISOString().slice(0, 10);
      const key = `${team}|||${weekKey}`;
      if (!map.has(key)) {
        map.set(key, {
          team,
          weekLabel: label,
          firstDay: formatDate(monday),
          lastDay: formatDate(sunday),
          draftFiles: 0,
          draftSqft: 0,
          draftMinutes: 0,
          reviewQaMinutes: 0,
          qaFiles: 0,
          qaSqft: 0,
          qaMinutes: 0,
          sortDate: monday.getTime(),
        });
      }
      return map.get(key)!;
    };

    draftSource.forEach((row) => {
      const team = normalizeValue(getField(row, COL_DRAFTER_TEAM));
      if (!team || !isRrePodTeam(team)) return;

      const date = getDateFromRow(row);
      if (!date) return;

      const monday = getMonday(date);
      const sunday = getSunday(date);
      const current = getOrCreate(team, monday, sunday, `Week ${getISOWeek(date)}`);

      current.draftFiles += 1;
      current.draftSqft += parseNumber(getField(row, ["Property SF (A)", "Property SF"]));
      current.draftMinutes += parseNumber(getField(row, ["Draft Time (C)", "Draft Time"]));
      current.reviewQaMinutes += parseNumber(getField(row, ["QA Time (D)", "QA Time"]));
    });

    qaSource.forEach((row) => {
      const team = normalizeValue(getField(row, COL_QA_TEAM));
      if (!team || !isRrePodTeam(team)) return;

      const date = getDateFromRow(row);
      if (!date) return;

      const monday = getMonday(date);
      const sunday = getSunday(date);
      const current = getOrCreate(team, monday, sunday, `Week ${getISOWeek(date)}`);

      current.qaFiles += 1;
      current.qaSqft += parseNumber(getField(row, ["Property SF (A)", "Property SF"]));
      current.qaMinutes += parseNumber(getField(row, ["QA Time (D)", "QA Time"]));
    });

    return Array.from(map.values())
      .sort((a, b) => {
        if (a.sortDate !== b.sortDate) return a.sortDate - b.sortDate;
        return a.team.localeCompare(b.team);
      })
      .map((item) => {
        const draftHours = item.draftMinutes / 60;
        const qaHours = item.qaMinutes / 60;
        return {
          team: item.team,
          weekLabel: item.weekLabel,
          firstDay: item.firstDay,
          lastDay: item.lastDay,
          draftFiles: item.draftFiles,
          draftHours,
          draftRate: draftHours > 0 ? item.draftSqft / draftHours : 0,
          qer: calculateQER(item.reviewQaMinutes, item.draftMinutes),
          qaFiles: item.qaFiles,
          qaHours,
          qaRate: qaHours > 0 ? item.qaSqft / qaHours : 0,
        };
      });
  }

  function buildTeamMemberWeeklyRows(
    draftSource: CsvRow[],
    qaSource: CsvRow[]
  ): TeamMemberWeeklyRow[] {
    const map = new Map<
      string,
      {
        team: string;
        name: string;
        weekLabel: string;
        firstDay: string;
        lastDay: string;
        draftFiles: number;
        draftSqft: number;
        draftMinutes: number;
        reviewQaMinutes: number;
        qaFiles: number;
        qaSqft: number;
        qaMinutes: number;
        qaDraftMinutes: number;
        l1Total: number;
        l2Total: number;
        l3Total: number;
        lRows: number;
        sortDate: number;
      }
    >();

    const getOrCreate = (
      team: string,
      name: string,
      monday: Date,
      sunday: Date,
      label: string
    ) => {
      const weekKey = monday.toISOString().slice(0, 10);
      const key = `${team}|||${name}|||${weekKey}`;
      if (!map.has(key)) {
        map.set(key, {
          team,
          name,
          weekLabel: label,
          firstDay: formatDate(monday),
          lastDay: formatDate(sunday),
          draftFiles: 0,
          draftSqft: 0,
          draftMinutes: 0,
          reviewQaMinutes: 0,
          qaFiles: 0,
          qaSqft: 0,
          qaMinutes: 0,
          qaDraftMinutes: 0,
          l1Total: 0,
          l2Total: 0,
          l3Total: 0,
          lRows: 0,
          sortDate: monday.getTime(),
        });
      }
      return map.get(key)!;
    };

    draftSource.forEach((row) => {
      const team = normalizeValue(getField(row, COL_DRAFTER_TEAM));
      const name = normalizeValue(getField(row, COL_DRAFTER_NAME));
      if (!team || !name || !isRrePodTeam(team)) return;

      const date = getDateFromRow(row);
      if (!date) return;

      const monday = getMonday(date);
      const sunday = getSunday(date);
      const current = getOrCreate(team, name, monday, sunday, `Week ${getISOWeek(date)}`);

      current.draftFiles += 1;
      current.draftSqft += parseNumber(getField(row, ["Property SF (A)", "Property SF"]));
      current.draftMinutes += parseNumber(getField(row, ["Draft Time (C)", "Draft Time"]));
      current.reviewQaMinutes += parseNumber(getField(row, ["QA Time (D)", "QA Time"]));
      current.l1Total += parseNumber(getField(row, ["L1 Errors", "L1/1000"]));
      current.l2Total += parseNumber(getField(row, ["L2 Errors", "L2/1000"]));
      current.l3Total += parseNumber(getField(row, ["L3 Errors", "L3/1000"]));
      current.lRows += 1;
    });

    qaSource.forEach((row) => {
      const team = normalizeValue(getField(row, COL_QA_TEAM));
      const name = normalizeValue(getField(row, COL_QA_NAME));
      const qaMinutes = parseNumber(getField(row, ["QA Time (D)", "QA Time"]));
      if (
        !team ||
        !name ||
        qaMinutes <= 0 ||
        !isRrePodTeam(team)
      ) {
        return;
      }

      const date = getDateFromRow(row);
      if (!date) return;

      const monday = getMonday(date);
      const sunday = getSunday(date);
      const current = getOrCreate(team, name, monday, sunday, `Week ${getISOWeek(date)}`);

      current.qaFiles += 1;
      current.qaSqft += parseNumber(getField(row, ["Property SF (A)", "Property SF"]));
      current.qaMinutes += qaMinutes;
      current.qaDraftMinutes += parseNumber(getField(row, ["Draft Time (C)", "Draft Time"]));
    });

    return Array.from(map.values())
      .sort((a, b) => {
        if (a.sortDate !== b.sortDate) return a.sortDate - b.sortDate;
        if (a.team !== b.team) return a.team.localeCompare(b.team);
        return a.name.localeCompare(b.name);
      })
      .map((item) => {
        const draftHours = item.draftMinutes / 60;
        const qaHours = item.qaMinutes / 60;
        const qer =
          item.draftMinutes > 0
            ? calculateQER(item.reviewQaMinutes, item.draftMinutes)
            : calculateQER(item.qaMinutes, item.qaDraftMinutes);

        return {
          team: item.team,
          name: item.name,
          weekLabel: item.weekLabel,
          firstDay: item.firstDay,
          lastDay: item.lastDay,
          draftFiles: item.draftFiles,
          draftHours,
          draftRate: draftHours > 0 ? item.draftSqft / draftHours : 0,
          qaFiles: item.qaFiles,
          qaHours,
          qaRate: qaHours > 0 ? item.qaSqft / qaHours : 0,
          qer,
          l1: item.lRows > 0 ? item.l1Total / item.lRows : 0,
          l2: item.lRows > 0 ? item.l2Total / item.lRows : 0,
          l3: item.lRows > 0 ? item.l3Total / item.lRows : 0,
        };
      });
  }

  const teamComparisonRows = useMemo<TeamComparisonRow[]>(() => {
    return buildTeamComparisonRows(filteredDraftData, filteredQAData);
  }, [filteredDraftData, filteredQAData]);

  const teamComparisonByPreset = useMemo(() => {
    return PRESET_OPTIONS.reduce<
      Partial<Record<Exclude<PresetMode, "manual">, TeamComparisonRow[]>>
    >((acc, preset) => {
      const draftRows = analyticsData.filter((row) => {
        if (!matchesPreset(row, preset.key)) return false;
        const drafterName = normalizeValue(getField(row, COL_DRAFTER_NAME));
        return drafterName !== "" && !teamLeadNames.has(drafterName);
      });

      const qaRows = analyticsData.filter((row) => {
        if (!matchesPreset(row, preset.key)) return false;
        const qaName = normalizeValue(getField(row, COL_QA_NAME));
        const qaMinutes = parseNumber(getField(row, ["QA Time (D)", "QA Time"]));
        return qaName !== "" && qaMinutes > 0 && !teamLeadNames.has(qaName);
      });

      acc[preset.key] = buildTeamComparisonRows(draftRows, qaRows);
      return acc;
    }, {});
  }, [analyticsData, teamLeadNames]);

  const teamMembersByPreset = useMemo(() => {
    return PRESET_OPTIONS.reduce<
      Partial<Record<Exclude<PresetMode, "manual">, TeamMemberSnapshotRow[]>>
    >((acc, preset) => {
      const map = new Map<
        string,
        {
          team: string;
          name: string;
          draftFiles: number;
          draftSqft: number;
          draftMinutes: number;
          reviewQaMinutes: number;
          qaFiles: number;
          qaSqft: number;
          qaMinutes: number;
          qaDraftMinutes: number;
          l1Total: number;
          l2Total: number;
          l3Total: number;
          lRows: number;
        }
      >();

      const getOrCreate = (team: string, name: string) => {
        const key = `${team}|||${name}`;
        if (!map.has(key)) {
          map.set(key, {
            team,
            name,
            draftFiles: 0,
            draftSqft: 0,
            draftMinutes: 0,
            reviewQaMinutes: 0,
            qaFiles: 0,
            qaSqft: 0,
            qaMinutes: 0,
            qaDraftMinutes: 0,
            l1Total: 0,
            l2Total: 0,
            l3Total: 0,
            lRows: 0,
          });
        }
        return map.get(key)!;
      };

      analyticsData.forEach((row) => {
        if (!matchesPreset(row, preset.key)) return;

        const team = normalizeValue(getField(row, COL_DRAFTER_TEAM));
        const name = normalizeValue(getField(row, COL_DRAFTER_NAME));
        if (!team || !name || teamLeadNames.has(name)) return;

        const current = getOrCreate(team, name);
        current.draftFiles += 1;
        current.draftSqft += parseNumber(getField(row, ["Property SF (A)", "Property SF"]));
        current.draftMinutes += parseNumber(getField(row, ["Draft Time (C)", "Draft Time"]));
        current.reviewQaMinutes += parseNumber(getField(row, ["QA Time (D)", "QA Time"]));
        current.l1Total += parseNumber(getField(row, ["L1 Errors", "L1/1000"]));
        current.l2Total += parseNumber(getField(row, ["L2 Errors", "L2/1000"]));
        current.l3Total += parseNumber(getField(row, ["L3 Errors", "L3/1000"]));
        current.lRows += 1;
      });

      analyticsData.forEach((row) => {
        if (!matchesPreset(row, preset.key)) return;

        const team = normalizeValue(getField(row, COL_QA_TEAM));
        const name = normalizeValue(getField(row, COL_QA_NAME));
        const qaMinutes = parseNumber(getField(row, ["QA Time (D)", "QA Time"]));
        if (!team || !name || qaMinutes <= 0 || teamLeadNames.has(name)) return;

        const current = getOrCreate(team, name);
        current.qaFiles += 1;
        current.qaSqft += parseNumber(getField(row, ["Property SF (A)", "Property SF"]));
        current.qaMinutes += qaMinutes;
        current.qaDraftMinutes += parseNumber(getField(row, ["Draft Time (C)", "Draft Time"]));
      });

      const rows = Array.from(map.values())
        .map((item) => {
          const draftHours = item.draftMinutes / 60;
          const qaHours = item.qaMinutes / 60;
          const draftRate = draftHours > 0 ? item.draftSqft / draftHours : 0;
          const qaRate = qaHours > 0 ? item.qaSqft / qaHours : 0;
          const qer =
            item.draftMinutes > 0
              ? calculateQER(item.reviewQaMinutes, item.draftMinutes)
              : calculateQER(item.qaMinutes, item.qaDraftMinutes);

          return {
            team: item.team,
            name: item.name,
            draftFiles: item.draftFiles,
            draftSqft: item.draftSqft,
            draftHours,
            draftRate,
            qaFiles: item.qaFiles,
            qaSqft: item.qaSqft,
            qaHours,
            qaRate,
            qer,
            l1: item.lRows > 0 ? item.l1Total / item.lRows : 0,
            l2: item.lRows > 0 ? item.l2Total / item.lRows : 0,
            l3: item.lRows > 0 ? item.l3Total / item.lRows : 0,
          };
        })
        .sort((a, b) => {
          if (a.team !== b.team) return a.team.localeCompare(b.team);
          if (b.draftRate !== a.draftRate) return b.draftRate - a.draftRate;
          if (b.qaRate !== a.qaRate) return b.qaRate - a.qaRate;
          return a.name.localeCompare(b.name);
        });

      acc[preset.key] = rows;
      return acc;
    }, {});
  }, [analyticsData, teamLeadNames]);

  const weeklyTeamsByPreset = useMemo(() => {
    return PRESET_OPTIONS.reduce<
      Partial<Record<Exclude<PresetMode, "manual">, WeeklyTeamRow[]>>
    >((acc, preset) => {
      const draftRows = analyticsData.filter((row) => {
        if (!matchesPreset(row, preset.key)) return false;
        const name = normalizeValue(getField(row, COL_DRAFTER_NAME));
        return name !== "" && !teamLeadNames.has(name);
      });

      const qaRows = analyticsData.filter((row) => {
        if (!matchesPreset(row, preset.key)) return false;
        const name = normalizeValue(getField(row, COL_QA_NAME));
        const qaMinutes = parseNumber(getField(row, ["QA Time (D)", "QA Time"]));
        return name !== "" && qaMinutes > 0 && !teamLeadNames.has(name);
      });

      acc[preset.key] = buildWeeklyTeamRows(draftRows, qaRows);
      return acc;
    }, {});
  }, [analyticsData, teamLeadNames]);

  const teamMembersWeeklyByPreset = useMemo(() => {
    return PRESET_OPTIONS.reduce<
      Partial<Record<Exclude<PresetMode, "manual">, TeamMemberWeeklyRow[]>>
    >((acc, preset) => {
      const draftRows = analyticsData.filter((row) => {
        if (!matchesPreset(row, preset.key)) return false;
        const name = normalizeValue(getField(row, COL_DRAFTER_NAME));
        return name !== "" && !teamLeadNames.has(name);
      });

      const qaRows = analyticsData.filter((row) => {
        if (!matchesPreset(row, preset.key)) return false;
        const name = normalizeValue(getField(row, COL_QA_NAME));
        const qaMinutes = parseNumber(getField(row, ["QA Time (D)", "QA Time"]));
        return name !== "" && qaMinutes > 0 && !teamLeadNames.has(name);
      });

      acc[preset.key] = buildTeamMemberWeeklyRows(draftRows, qaRows);
      return acc;
    }, {});
  }, [analyticsData, teamLeadNames]);

  const teamComparisonRanges = useMemo(() => {
    const maxDraftRate = Math.max(
      1,
      ...teamComparisonRows.map((row) => row.draftRate)
    );
    const maxQaRate = Math.max(1, ...teamComparisonRows.map((row) => row.qaRate));
    const maxHours = Math.max(
      1,
      ...teamComparisonRows.map((row) => row.draftHours + row.qaHours)
    );

    return { maxDraftRate, maxQaRate, maxHours };
  }, [teamComparisonRows]);

  const topDraftersByTeam = useMemo<TeamLeaderRow[]>(() => {
    const byTeam = new Map<
      string,
      Map<string, { files: number; sqft: number; minutes: number }>
    >();

    filteredDraftData.forEach((row) => {
      const team = normalizeValue(getField(row, COL_DRAFTER_TEAM));
      const name = normalizeValue(getField(row, COL_DRAFTER_NAME));
      if (!team || !name) return;

      if (!byTeam.has(team)) byTeam.set(team, new Map());
      const byPerson = byTeam.get(team)!;

      if (!byPerson.has(name)) {
        byPerson.set(name, { files: 0, sqft: 0, minutes: 0 });
      }

      const current = byPerson.get(name)!;
      current.files += 1;
      current.sqft += parseNumber(getField(row, ["Property SF (A)", "Property SF"]));
      current.minutes += parseNumber(getField(row, ["Draft Time (C)", "Draft Time"]));
    });

    return FOCUS_TEAMS.map((team) => {
      const byPerson = byTeam.get(team);
      if (!byPerson || byPerson.size === 0) {
        return { team, name: "(sin datos)", rate: 0, files: 0, hours: 0 };
      }

      const leaders = Array.from(byPerson.entries()).map(([name, item]) => {
        const hours = item.minutes / 60;
        const rate = hours > 0 ? item.sqft / hours : 0;

        return {
          team,
          name,
          rate,
          files: item.files,
          hours,
        };
      });

      leaders.sort((a, b) => {
        if (b.rate !== a.rate) return b.rate - a.rate;
        if (b.files !== a.files) return b.files - a.files;
        return a.name.localeCompare(b.name);
      });

      return leaders[0];
    });
  }, [filteredDraftData]);

  const topQaByTeam = useMemo<TeamLeaderRow[]>(() => {
    const byTeam = new Map<
      string,
      Map<string, { files: number; sqft: number; minutes: number }>
    >();

    filteredQAData.forEach((row) => {
      const team = normalizeValue(getField(row, COL_QA_TEAM));
      const name = normalizeValue(getField(row, COL_QA_NAME));
      if (!team || !name) return;

      if (!byTeam.has(team)) byTeam.set(team, new Map());
      const byPerson = byTeam.get(team)!;

      if (!byPerson.has(name)) {
        byPerson.set(name, { files: 0, sqft: 0, minutes: 0 });
      }

      const current = byPerson.get(name)!;
      current.files += 1;
      current.sqft += parseNumber(getField(row, ["Property SF (A)", "Property SF"]));
      current.minutes += parseNumber(getField(row, ["QA Time (D)", "QA Time"]));
    });

    return FOCUS_TEAMS.map((team) => {
      const byPerson = byTeam.get(team);
      if (!byPerson || byPerson.size === 0) {
        return { team, name: "(sin datos)", rate: 0, files: 0, hours: 0 };
      }

      const leaders = Array.from(byPerson.entries()).map(([name, item]) => {
        const hours = item.minutes / 60;
        const rate = hours > 0 ? item.sqft / hours : 0;

        return {
          team,
          name,
          rate,
          files: item.files,
          hours,
        };
      });

      leaders.sort((a, b) => {
        if (b.rate !== a.rate) return b.rate - a.rate;
        if (b.files !== a.files) return b.files - a.files;
        return a.name.localeCompare(b.name);
      });

      return leaders[0];
    });
  }, [filteredQAData]);

  const presetDistribution = useMemo<PresetDistributionRow[]>(() => {
    return PRESET_OPTIONS.map((preset) => {
      const rows = analyticsData.filter((row) => matchesPreset(row, preset.key));

      const draftRows = rows.filter(
        (row) => normalizeValue(getField(row, COL_DRAFTER_NAME)) !== ""
      ).length;
      const qaRows = rows.filter((row) => {
        return (
          normalizeValue(getField(row, COL_QA_NAME)) !== "" &&
          parseNumber(getField(row, ["QA Time (D)", "QA Time"])) > 0
        );
      }).length;

      const totalMinutes = rows.reduce((sum, row) => {
        return (
          sum +
          parseNumber(getField(row, ["Draft Time (C)", "Draft Time"])) +
          parseNumber(getField(row, ["QA Time (D)", "QA Time"]))
        );
      }, 0);

      return {
        preset: preset.key,
        label: preset.label,
        draftRows,
        qaRows,
        totalRows: rows.length,
        totalHours: totalMinutes / 60,
      };
    });
  }, [analyticsData]);

  function toggleValue(
    value: string,
    list: string[],
    setter: (v: string[]) => void
  ) {
    if (list.includes(value)) {
      setter(list.filter((v) => v !== value));
    } else {
      setter([...list, value]);
    }
  }

  function applyPreset(mode: PresetMode) {
    setPresetMode(mode);

    switch (mode) {
      case "combined":
      case "manual":
        setSelectedTypes([]);
        setSelectedTenK([]);
        setSelectedAds([]);
        break;
      case "std":
        setSelectedTypes(["draft"]);
        setSelectedTenK(["below", "blank"]);
        setSelectedAds(["blank"]);
        break;
      case "premium":
        setSelectedTypes(["draft-premium"]);
        setSelectedTenK(["below", "blank"]);
        setSelectedAds(["blank"]);
        break;
      case "ads_std":
        setSelectedTypes(["draft"]);
        setSelectedTenK(["below"]);
        setSelectedAds(["ads"]);
        break;
      case "ads_prem":
        setSelectedTypes(["draft-premium"]);
        setSelectedTenK(["below"]);
        setSelectedAds(["ads"]);
        break;
      case "gt10k":
        setSelectedTypes(["draft", "draft-premium"]);
        setSelectedTenK(["above"]);
        setSelectedAds(["blank", "ads"]);
        break;
      default:
        setSelectedTypes([]);
        setSelectedTenK([]);
        setSelectedAds([]);
        break;
    }

    setSelectedTeams([]);
    setEditingPersonKey(null);
    setDetailPersonName(null);
  }

  function formatFilterOption(value: string) {
    const token = normalizeToken(value);

    if (token === "blank" || token === "") return "(blank)";
    if (token === "below") return "Below";
    if (token === "above") return "Above";
    if (token === "ads") return "ADS";

    return value;
  }

  function renderFilterBox({
    title,
    values,
    selected,
    onToggle,
  }: {
    title: string;
    values: string[];
    selected: string[];
    onToggle: (v: string) => void;
  }) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <h4 className="mb-3 text-sm font-semibold text-slate-700">{title}</h4>

        <div className="max-h-52 overflow-y-auto rounded-xl bg-white p-2 ring-1 ring-slate-200">
          {values.length === 0 ? (
            <p className="px-2 py-2 text-sm text-slate-400">Sin datos</p>
          ) : (
            <div className="space-y-1">
              {values.map((v) => {
                const active = selected.includes(v);
                const label = formatFilterOption(v);

                return (
                  <label
                    key={v || "(blank)"}
                    className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => onToggle(v)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="break-words leading-5">
                      {label}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasData = combinedData.length > 0;

  function getPersonConfig(name: string): PersonConfig {
    const base = personConfig[name] ?? {
      level: "Junior",
      primaryRole: "Drafter",
      functions: ["Draft"],
      isTeamLead: false,
    };

    return {
      ...base,
      isTeamLead: base.isTeamLead === true,
    };
  }

  function updatePersonConfig(name: string, updates: Partial<PersonConfig>) {
    setPersonConfig((prev) => ({
      ...prev,
      [name]: {
        ...getPersonConfig(name),
        ...updates,
      },
    }));
  }

  function togglePersonFunction(name: string, fn: PersonFunction) {
    const config = getPersonConfig(name);
    const exists = config.functions.includes(fn);

    updatePersonConfig(name, {
      functions: exists
        ? config.functions.filter((item) => item !== fn)
        : [...config.functions, fn],
    });
  }

  function getTargetLabel(name: string) {
    const config = getPersonConfig(name);

    if (config.primaryRole === "QA") {
      return `${formatNumber(QA_TARGET_MIN, 0)} - ${formatNumber(
        QA_TARGET_MAX,
        0
      )}`;
    }

    return formatNumber(LEVEL_TARGETS[config.level], 0);
  }

  const activePreset =
    PRESET_OPTIONS.find((option) => option.key === presetMode) ??
    PRESET_OPTIONS[0];

  useEffect(() => {
    if (typeof window === "undefined" || !hasData || !shouldComputeAnalytics) return;

    const snapshot: DashboardSnapshot = {
      generatedAt: new Date().toISOString(),
      preset: presetMode,
      presetLabel: activePreset.label,
      summary: {
        totalRows: summary.totalRows,
        totalPropertySF: summary.totalPropertySF,
        totalTime: summary.totalTime,
        avgDraftRate: summary.avgDraftRate,
        avgQER: summary.avgQER,
        avgL1: summary.avgL1,
        avgL2: summary.avgL2,
        avgL3: summary.avgL3,
        qaFiles: summary.qaFiles,
        qaPropertySF: summary.qaPropertySF,
        qaTime: summary.qaTime,
        avgQARate: summary.avgQARate,
      },
      teams: teamComparisonRows,
      teamComparisonByPreset,
      teamMembersByPreset,
      weeklyTeamsByPreset,
      teamMembersWeeklyByPreset,
      weeklyRows: weeklyRowsWithTotal,
      topDraftersByTeam,
      topQaByTeam,
      presetDistribution,
    };

    const serializedSnapshot = JSON.stringify(snapshot);
    if (serializedSnapshot === lastSerializedSnapshotRef.current) return;

    const cloudStatePayload = {
      snapshot,
      batches: {
        standard: standardBatches,
        australia: australiaBatches,
        updatedAt: snapshot.generatedAt,
      },
      updatedAt: snapshot.generatedAt,
    };
    const serializedCloudState = JSON.stringify(cloudStatePayload);

    let cancelled = false;
    const commitSnapshot = () => {
      if (cancelled) return;
      if (serializedSnapshot === lastSerializedSnapshotRef.current) return;

      const saved = safeSetLocalStorage(DASHBOARD_SNAPSHOT_KEY, serializedSnapshot);
      if (saved) {
        lastSerializedSnapshotRef.current = serializedSnapshot;
        window.dispatchEvent(new Event(DASHBOARD_SNAPSHOT_EVENT));
        setForceSnapshotRefresh(false);

        if (serializedCloudState !== lastSerializedCloudStateRef.current) {
          lastSerializedCloudStateRef.current = serializedCloudState;
          void persistRemoteDashboardState(cloudStatePayload).catch(() => {});
        }
      }
    };

    const idleCallback = (window as unknown as {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number }
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    const cancelIdleCallback = (window as unknown as {
      cancelIdleCallback?: (id: number) => void;
    }).cancelIdleCallback;

    let idleId: number | null = null;
    let timeoutId: number | null = null;

    if (typeof idleCallback === "function") {
      idleId = idleCallback(commitSnapshot, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(commitSnapshot, 120);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    activePreset.label,
    hasData,
    shouldComputeAnalytics,
    presetMode,
    summary.avgDraftRate,
    summary.avgL1,
    summary.avgL2,
    summary.avgL3,
    summary.avgQARate,
    summary.avgQER,
    summary.qaFiles,
    summary.qaPropertySF,
    summary.qaTime,
    summary.totalPropertySF,
    summary.totalRows,
    summary.totalTime,
    topDraftersByTeam,
    topQaByTeam,
    presetDistribution,
    standardBatches,
    australiaBatches,
    teamComparisonByPreset,
    teamMembersByPreset,
    weeklyTeamsByPreset,
    teamMembersWeeklyByPreset,
    teamComparisonRows,
    weeklyRowsWithTotal,
  ]);

  function buildPersonBreakdown(name: string): PersonBreakdownRow[] {
    return PRESET_OPTIONS.map((preset) => {
      const draftRows = analyticsData.filter((row) => {
        return (
          normalizeValue(getField(row, COL_DRAFTER_NAME)) === name &&
          matchesPreset(row, preset.key)
        );
      });

      const draftFiles = draftRows.length;
      const draftPropertySF = draftRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["Property SF (A)", "Property SF"])),
        0
      );
      const draftMinutes = draftRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["Draft Time (C)", "Draft Time"])),
        0
      );
      const reviewQaMinutes = draftRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["QA Time (D)", "QA Time"])),
        0
      );

      const l1Total = draftRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["L1 Errors", "L1/1000"])),
        0
      );
      const l2Total = draftRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["L2 Errors", "L2/1000"])),
        0
      );
      const l3Total = draftRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["L3 Errors", "L3/1000"])),
        0
      );

      const qaRows = analyticsData.filter((row) => {
        return (
          normalizeValue(getField(row, COL_QA_NAME)) === name &&
          matchesPreset(row, preset.key) &&
          parseNumber(getField(row, ["QA Time (D)", "QA Time"])) > 0
        );
      });

      const qaFiles = qaRows.length;
      const qaPropertySF = qaRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["Property SF (A)", "Property SF"])),
        0
      );
      const qaMinutes = qaRows.reduce(
        (sum, row) => sum + parseNumber(getField(row, ["QA Time (D)", "QA Time"])),
        0
      );

      const draftHours = draftMinutes / 60;
      const qaHours = qaMinutes / 60;

      return {
        preset: preset.label,
        draftFiles,
        draftHours,
        draftRate: draftHours > 0 ? draftPropertySF / draftHours : 0,
        qer: calculateQER(reviewQaMinutes, draftMinutes),
        l1: draftFiles > 0 ? l1Total / draftFiles : 0,
        l2: draftFiles > 0 ? l2Total / draftFiles : 0,
        l3: draftFiles > 0 ? l3Total / draftFiles : 0,
        qaFiles,
        qaHours,
        qaRate: qaHours > 0 ? qaPropertySF / qaHours : 0,
      };
    });
  }

  function renderPersonBreakdown(name: string) {
    const rows = buildPersonBreakdown(name);

    return (
      <div className="mt-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <p className="mb-3 text-sm font-semibold text-slate-900">
          Tiempo por tipo de archivo - {name}
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-3">Vista</th>
                <th className="py-2 pr-3">Draft Files</th>
                <th className="py-2 pr-3">Draft Time (h)</th>
                <th className="py-2 pr-3">Draft Rate</th>
                <th className="py-2 pr-3">QER</th>
                <th className="py-2 pr-3">L1</th>
                <th className="py-2 pr-3">L2</th>
                <th className="py-2 pr-3">L3</th>
                <th className="py-2 pr-3">QA Files</th>
                <th className="py-2 pr-3">QA Time (h)</th>
                <th className="py-2 pr-3">QA Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${name}-${row.preset}`} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-medium">{row.preset}</td>
                  <td className="py-2 pr-3">{formatNumber(row.draftFiles, 0)}</td>
                  <td className="py-2 pr-3">{formatNumber(row.draftHours, 2)}</td>
                  <td className="py-2 pr-3">{formatNumber(row.draftRate, 0)}</td>
                  <td className="py-2 pr-3">{formatNumber(row.qer, 1)}%</td>
                  <td className="py-2 pr-3">{formatNumber(row.l1, 2)}</td>
                  <td className="py-2 pr-3">{formatNumber(row.l2, 2)}</td>
                  <td className="py-2 pr-3">{formatNumber(row.l3, 2)}</td>
                  <td className="py-2 pr-3">{formatNumber(row.qaFiles, 0)}</td>
                  <td className="py-2 pr-3">{formatNumber(row.qaHours, 2)}</td>
                  <td className="py-2 pr-3">{formatNumber(row.qaRate, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderMetricChip(
    value: number,
    decimals: number,
    tone: MetricTone,
    suffix = ""
  ) {
    return (
      <span
        className={`inline-flex min-w-[78px] justify-center rounded-full px-3 py-1 text-xs font-semibold ${getMetricToneClass(
          tone
        )}`}
      >
        {formatNumber(value, decimals)}
        {suffix}
      </span>
    );
  }

  function renderPersonEditor(name: string, context: "draft" | "qa") {
    const config = getPersonConfig(name);
    const editorKey = `${context}:${name}`;
    const isOpen = editingPersonKey === editorKey;

    return (
      <>
        <button
          onClick={() =>
            setEditingPersonKey(isOpen ? null : editorKey)
          }
          className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200"
        >
          {isOpen ? "Cerrar" : "Editar"}
        </button>

        {isOpen && (
          <div className="mt-3 min-w-[260px] rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Nivel
                </label>
                <select
                  value={config.level}
                  onChange={(e) =>
                    updatePersonConfig(name, {
                      level: e.target.value as Level,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="Junior">Junior</option>
                  <option value="Intermedio">Intermedio</option>
                  <option value="Senior">Senior</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Rol principal
                </label>
                <select
                  value={config.primaryRole}
                  onChange={(e) =>
                    updatePersonConfig(name, {
                      primaryRole: e.target.value as PrimaryRole,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="Drafter">Drafter</option>
                  <option value="QA">QA</option>
                  <option value="Updates">Updates</option>
                </select>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-slate-600">
                  Funciones
                </p>
                <div className="space-y-2">
                  {ALL_FUNCTIONS.map((fn) => (
                    <label
                      key={`${editorKey}-${fn}`}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={config.functions.includes(fn)}
                        onChange={() => togglePersonFunction(name, fn)}
                      />
                      <span>{fn}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                <label className="flex items-start gap-2 text-sm text-amber-900">
                  <input
                    type="checkbox"
                    checked={config.isTeamLead === true}
                    onChange={(e) =>
                      updatePersonConfig(name, {
                        isTeamLead: e.target.checked,
                      })
                    }
                    className="mt-0.5"
                  />
                  <span>
                    Líder de equipo (sin métricas)
                    <span className="mt-1 block text-xs text-amber-700">
                      Si está activo, esta persona no aparece en ranking ni en métricas operativas.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-[32px] border border-amber-200/70 bg-[linear-gradient(180deg,#FCD116_0%,#FCD116_52%,#003893_52%,#003893_76%,#CE1126_76%,#CE1126_100%)] px-6 py-8 shadow-[0_24px_64px_-36px_rgba(15,23,42,0.3)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(255,255,255,0.5),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.22),rgba(255,255,255,0.02)_58%)]"
        />
        <div className="relative max-w-4xl rounded-[28px] border border-white/45 bg-white/72 px-5 py-5 shadow-[0_20px_46px_-30px_rgba(15,23,42,0.42)] backdrop-blur-[4px] sm:px-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-700">
            Upload Center
          </p>
          <h2 className="mt-2 font-[var(--font-space-grotesk)] text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Metrics Planitar
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-slate-700 sm:text-base">
            Upload your metrics reports, activate operational presets, and compare
            Draft and QA performance by team with an executive view.
          </p>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.98)_100%)] p-5 shadow-sm">
          <p className="mb-1 text-base font-semibold text-slate-950">Standard File</p>
          <p className="mb-3 text-xs text-slate-500">
            Upload the main team CSV file.
          </p>
          <input
            id="standard-upload"
            ref={standardInputRef}
            type="file"
            multiple
            accept=".csv,text/csv,application/vnd.ms-excel"
            onChange={(e) => {
              handleInputSelection("standard", e.currentTarget.files);
            }}
            className="block w-full cursor-pointer rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-3 py-3 text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-blue-700 file:px-4 file:py-2.5 file:text-xs file:font-semibold file:text-white hover:border-blue-300"
          />
          {pendingStandardFiles.length > 0 && (
            <p className="mt-2 text-xs font-medium text-blue-700">
              Pending: {pendingStandardFiles.length} file(s) selected for processing.
            </p>
          )}
          <button
            type="button"
            onClick={() => void openNativeFilePicker("standard")}
            className="mt-3 inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
          >
            Open Standard Browser
          </button>
          {standardFile && (
            <p className="mt-3 rounded-2xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">
              Latest: {standardFile} | History: {standardBatches.length} files /{" "}
              {standardRowCount} rows
            </p>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.98)_100%)] p-5 shadow-sm">
          <p className="mb-1 text-base font-semibold text-slate-950">Australia File</p>
          <p className="mb-3 text-xs text-slate-500">
            Upload the additional CSV used to combine sources.
          </p>
          <input
            id="australia-upload"
            ref={australiaInputRef}
            type="file"
            multiple
            accept=".csv,text/csv,application/vnd.ms-excel"
            onChange={(e) => {
              handleInputSelection("australia", e.currentTarget.files);
            }}
            className="block w-full cursor-pointer rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-3 py-3 text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-blue-700 file:px-4 file:py-2.5 file:text-xs file:font-semibold file:text-white hover:border-blue-300"
          />
          {pendingAustraliaFiles.length > 0 && (
            <p className="mt-2 text-xs font-medium text-blue-700">
              Pending: {pendingAustraliaFiles.length} file(s) selected for processing.
            </p>
          )}
          <button
            type="button"
            onClick={() => void openNativeFilePicker("australia")}
            className="mt-3 inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
          >
            Open Australia Browser
          </button>
          {australiaFile && (
            <p className="mt-3 rounded-2xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">
              Latest: {australiaFile} | History: {australiaBatches.length} files /{" "}
              {australiaRowCount} rows
            </p>
          )}
        </div>
      </div>

      <div className="rounded-[28px] border border-violet-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(245,243,255,0.98)_100%)] p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-base font-semibold text-slate-950">
            Novedades / Schedule (.xlsx)
          </p>
          <span className="rounded-full bg-violet-100 px-3 py-1 text-[11px] font-semibold text-violet-700">
            Vacaciones · Días libres · Media jornada · WFH · Calamidad · Incapacidad
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Sube el archivo &ldquo;CO Staff 2026.xlsx&rdquo; (con todas las pestañas mensuales) y se cruzará con los perfiles para mostrar las novedades por día.
        </p>
        <input
          ref={scheduleInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0] ?? null;
            void handleScheduleFile(f);
          }}
          className="mt-3 block w-full cursor-pointer rounded-2xl border border-dashed border-violet-300 bg-violet-50/40 px-3 py-3 text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-violet-700 file:px-4 file:py-2.5 file:text-xs file:font-semibold file:text-white hover:border-violet-400"
          disabled={scheduleProcessing}
        />
        {scheduleProcessing ? (
          <p className="mt-3 text-xs font-medium text-violet-700">Procesando...</p>
        ) : null}
        {scheduleError ? (
          <p className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
            {scheduleError}
          </p>
        ) : null}
        {scheduleWarnings.length > 0 ? (
          <ul className="mt-3 space-y-1 rounded-2xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
            {scheduleWarnings.map((w, i) => (
              <li key={`schedule-warn-${i}`}>• {w}</li>
            ))}
          </ul>
        ) : null}
        {scheduleBatches.length > 0 ? (
          <div className="mt-3 rounded-2xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">
            <p className="font-semibold">
              {scheduleBatches.length} archivo
              {scheduleBatches.length === 1 ? "" : "s"} cargado
              {scheduleBatches.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-1 space-y-0.5">
              {scheduleBatches.flatMap((b) =>
                b.months.map((m) => {
                  const eventCount = m.people.reduce(
                    (s, p) => s + Object.keys(p.events).length,
                    0
                  );
                  return (
                    <li key={`sb-${b.id}-${m.sheetName}`}>
                      {b.fileName} → {m.sheetName} {m.year}: {m.people.length} personas,{" "}
                      {eventCount} novedades
                    </li>
                  );
                })
              )}
            </ul>
            <button
              type="button"
              onClick={() => void clearScheduleHistory()}
              className="mt-2 inline-flex items-center rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
            >
              Limpiar histórico
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={processSelectedInputs}
          disabled={isProcessingUploads}
          className="inline-flex items-center rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-800"
        >
          {isProcessingUploads ? "Processing..." : "Process Files and Show Metrics"}
        </button>
        <button
          type="button"
          onClick={clearUploadHistory}
          disabled={isProcessingUploads}
          className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Reset Weekly History
        </button>
        <p className="text-xs text-slate-500">
          You can upload multiple CSV files per week and they accumulate automatically in history.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 p-4 text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      {hasData && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Files processed successfully. Analytics are now available in Dashboard, Teams, History, and Profile.
        </section>
      )}

      {SHOW_UPLOAD_ANALYTICS && hasData && (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap gap-2">
                {PRESET_OPTIONS.map((mode) => {
                  const active = presetMode === mode.key;
                  return (
                    <button
                      key={mode.key}
                      onClick={() => applyPreset(mode.key)}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        active
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <p className="text-sm font-semibold text-slate-900">
                  {activePreset.label}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {activePreset.description}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Filas filtradas: Draft {formatNumber(filteredDraftData.length, 0)} / QA{" "}
                  {formatNumber(filteredQAData.length, 0)}
                </p>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-xs">
                <p className="font-semibold text-amber-900">Debug de extracción (temporal)</p>
                <p className="mt-2 text-amber-900">
                  Type:{" "}
                  {uniqueTypes.slice(0, 20).map((value) => formatFilterOption(value)).join(" | ") ||
                    "Sin datos"}
                </p>
                <p className="mt-1 text-amber-900">
                  10k:{" "}
                  {uniqueTenK.slice(0, 20).map((value) => formatFilterOption(value)).join(" | ") ||
                    "Sin datos"}
                </p>
                <p className="mt-1 text-amber-900">
                  ADS:{" "}
                  {uniqueAds.slice(0, 20).map((value) => formatFilterOption(value)).join(" | ") ||
                    "Sin datos"}
                </p>
              </div>

              <div className="mt-5 space-y-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Team
              </label>

              <select
                value={selectedTeams[0] ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedTeams(value ? [value] : []);
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500"
              >
                <option value="">Todos los equipos</option>
                {uniqueTeams.map((team) => (
                  <option key={team} value={team}>
                    {team || "(blank)"}
                  </option>
                ))}
              </select>
            </div>

            <details className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <summary className="cursor-pointer list-none text-sm font-semibold text-slate-700">
                Más filtros
              </summary>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {renderFilterBox({
                  title: "Type",
                  values: uniqueTypes,
                  selected: selectedTypes,
                  onToggle: (v) => toggleValue(v, selectedTypes, setSelectedTypes),
                })}

                {renderFilterBox({
                  title: "10k",
                  values: uniqueTenK,
                  selected: selectedTenK,
                  onToggle: (v) => toggleValue(v, selectedTenK, setSelectedTenK),
                })}

                {renderFilterBox({
                  title: "ADS",
                  values: uniqueAds,
                  selected: selectedAds,
                  onToggle: (v) => toggleValue(v, selectedAds, setSelectedAds),
                })}
              </div>
            </details>
          </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">Draft Files</p>
                <p className="mt-2 text-3xl font-bold">
                  {formatNumber(summary.totalRows, 0)}
                </p>
              </div>

              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">Draft Sqft</p>
                <p className="mt-2 text-3xl font-bold">
                  {formatNumber(summary.totalPropertySF, 0)}
                </p>
              </div>

              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">Draft Hours</p>
                <p className="mt-2 text-3xl font-bold">
                  {formatNumber(summary.totalTime, 2)}
                </p>
              </div>

              <div className="rounded-2xl bg-blue-50 p-5 shadow-sm ring-1 ring-blue-200">
                <p className="text-sm text-blue-700">Avg Draft Rate</p>
                <p className="mt-2 text-3xl font-bold text-blue-900">
                  {formatNumber(summary.avgDraftRate, 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Avg QER</p>
              <div className="mt-3">
                {renderMetricChip(summary.avgQER, 1, getQERTone(summary.avgQER), "%")}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Avg L1</p>
              <div className="mt-3">
                {renderMetricChip(summary.avgL1, 2, getErrorTone(summary.avgL1))}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Avg L2</p>
              <div className="mt-3">
                {renderMetricChip(summary.avgL2, 2, getErrorTone(summary.avgL2))}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Avg L3</p>
              <div className="mt-3">
                {renderMetricChip(summary.avgL3, 2, getErrorTone(summary.avgL3))}
              </div>
            </div>

            <div className="rounded-2xl bg-emerald-50 p-5 shadow-sm ring-1 ring-emerald-200">
              <p className="text-sm text-emerald-700">QA Files</p>
              <p className="mt-2 text-2xl font-bold text-emerald-900">
                {formatNumber(summary.qaFiles, 0)}
              </p>
            </div>

            <div className="rounded-2xl bg-emerald-50 p-5 shadow-sm ring-1 ring-emerald-200">
              <p className="text-sm text-emerald-700">Avg QA Rate</p>
              <p className="mt-2 text-2xl font-bold text-emerald-900">
                {formatNumber(summary.avgQARate, 0)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">Comparacion de Equipos</h3>
                  <p className="text-sm text-slate-500">
                    Vista ejecutiva para RRECO1, RRECO2 y RRECO3.
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  Preset: {activePreset.label}
                </span>
              </div>

              <div className="space-y-4">
                {teamComparisonRows.map((team) => {
                  const draftWidth =
                    (team.draftRate / teamComparisonRanges.maxDraftRate) * 100;
                  const qaWidth =
                    (team.qaRate / teamComparisonRanges.maxQaRate) * 100;
                  const totalHours = team.draftHours + team.qaHours;
                  const hoursWidth =
                    (totalHours / teamComparisonRanges.maxHours) * 100;

                  return (
                    <div
                      key={team.team}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-900">{team.team}</p>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-500 ring-1 ring-slate-200">
                          Files D/QA: {formatNumber(team.draftFiles, 0)} /{" "}
                          {formatNumber(team.qaFiles, 0)}
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                            <span>Draft Rate</span>
                            <span>{formatNumber(team.draftRate, 0)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-200">
                            <div
                              className="h-2 rounded-full bg-blue-500"
                              style={{ width: `${Math.max(draftWidth, 2)}%` }}
                            />
                          </div>
                        </div>

                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                            <span>QA Rate</span>
                            <span>{formatNumber(team.qaRate, 0)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-200">
                            <div
                              className="h-2 rounded-full bg-emerald-500"
                              style={{ width: `${Math.max(qaWidth, 2)}%` }}
                            />
                          </div>
                        </div>

                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                            <span>Total Hours</span>
                            <span>{formatNumber(totalHours, 2)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-200">
                            <div
                              className="h-2 rounded-full bg-violet-500"
                              style={{ width: `${Math.max(hoursWidth, 2)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h3 className="text-xl font-semibold">Scorecard de Equipos</h3>
              <p className="mt-1 text-sm text-slate-500">
                Comparativo directo de calidad y velocidad.
              </p>

              <div className="mt-5 space-y-3">
                {teamComparisonRows.map((team) => (
                  <div
                    key={`score-${team.team}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <p className="text-sm font-semibold text-slate-900">{team.team}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl bg-white p-2 ring-1 ring-slate-200">
                        <p className="text-slate-500">QER</p>
                        <p className="mt-1 font-semibold text-slate-900">
                          {formatNumber(team.qer, 1)}%
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-2 ring-1 ring-slate-200">
                        <p className="text-slate-500">Draft Hrs</p>
                        <p className="mt-1 font-semibold text-slate-900">
                          {formatNumber(team.draftHours, 2)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-2 ring-1 ring-slate-200">
                        <p className="text-slate-500">QA Hrs</p>
                        <p className="mt-1 font-semibold text-slate-900">
                          {formatNumber(team.qaHours, 2)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-2 ring-1 ring-slate-200">
                        <p className="text-slate-500">Balance</p>
                        <p className="mt-1 font-semibold text-slate-900">
                          {formatNumber(team.draftHours - team.qaHours, 2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold">Acumulado semanal</h3>
                <p className="text-sm text-slate-500">
                  Resumen operativo por semana.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-3 pr-4">Week</th>
                    <th className="py-3 pr-4">From</th>
                    <th className="py-3 pr-4">To</th>
                    <th className="py-3 pr-4">Draft Files</th>
                    <th className="py-3 pr-4">Sqft</th>
                    <th className="py-3 pr-4">Hours</th>
                    <th className="py-3 pr-4">Draft Rate</th>
                    <th className="py-3 pr-4">QER</th>
                    <th className="py-3 pr-4">L1</th>
                    <th className="py-3 pr-4">L2</th>
                    <th className="py-3 pr-4">L3</th>
                    <th className="py-3 pr-4">QA Files</th>
                    <th className="py-3 pr-4">QA Hours</th>
                    <th className="py-3 pr-4">QA Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyRowsWithTotal.map((week) => (
                    <tr
                      key={`${week.weekLabel}-${week.firstDay}-${week.lastDay}`}
                      className={`border-b align-top ${
                        week.isTotal
                          ? "border-slate-200 bg-slate-50 font-semibold"
                          : "border-slate-100"
                      }`}
                    >
                      <td className="py-4 pr-4 font-medium">{week.weekLabel}</td>
                      <td className="py-4 pr-4">{week.firstDay || "-"}</td>
                      <td className="py-4 pr-4">{week.lastDay || "-"}</td>
                      <td className="py-4 pr-4">{formatNumber(week.fileCount, 0)}</td>
                      <td className="py-4 pr-4">{formatNumber(week.propertySF, 0)}</td>
                      <td className="py-4 pr-4">{formatNumber(week.time, 2)}</td>
                      <td className="py-4 pr-4">
                        {renderMetricChip(
                          week.avgDraftRate,
                          0,
                          getDraftMetricTone(week.avgDraftRate, "Intermedio", week.time)
                        )}
                      </td>
                      <td className="py-4 pr-4">
                        {renderMetricChip(week.avgQER, 1, getQERTone(week.avgQER), "%")}
                      </td>
                      <td className="py-4 pr-4">
                        {renderMetricChip(week.avgL1, 2, getErrorTone(week.avgL1))}
                      </td>
                      <td className="py-4 pr-4">
                        {renderMetricChip(week.avgL2, 2, getErrorTone(week.avgL2))}
                      </td>
                      <td className="py-4 pr-4">
                        {renderMetricChip(week.avgL3, 2, getErrorTone(week.avgL3))}
                      </td>
                      <td className="py-4 pr-4">{formatNumber(week.qaFiles, 0)}</td>
                      <td className="py-4 pr-4">{formatNumber(week.qaTime, 2)}</td>
                      <td className="py-4 pr-4">
                        {renderMetricChip(
                          week.avgQARate,
                          0,
                          getQAMetricTone(week.avgQARate, week.qaTime)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold">Ranking Drafters</h3>
                <p className="text-sm text-slate-500">
                  Vista semanal del equipo de Draft.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                {rankingDrafters.length} personas
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-3 pr-4">Nombre</th>
                    <th className="py-3 pr-4">Rol</th>
                    <th className="py-3 pr-4">Nivel</th>
                    <th className="py-3 pr-4">Target</th>
                    <th className="py-3 pr-4">Files</th>
                    <th className="py-3 pr-4">Sqft</th>
                    <th className="py-3 pr-4">Hours</th>
                    <th className="py-3 pr-4">Draft Rate</th>
                    <th className="py-3 pr-4">QER %</th>
                    <th className="py-3 pr-4">L1</th>
                    <th className="py-3 pr-4">L2</th>
                    <th className="py-3 pr-4">L3</th>
                    <th className="py-3 pr-4">Editar</th>
                  </tr>
                </thead>
                <tbody>
                  {draftRowsWithTotal.map((person) => {
                    const config = person.isTotal
                      ? null
                      : getPersonConfig(person.name);
                    const draftTone = config
                      ? getDraftMetricTone(
                          person.draftRate,
                          config.level,
                          person.time
                        )
                      : getDraftMetricTone(
                          person.draftRate,
                          "Intermedio",
                          person.time
                        );

                    return (
                      <tr
                        key={person.name}
                        className={`border-b align-top ${
                          person.isTotal
                            ? "border-slate-200 bg-slate-50 font-semibold"
                            : "border-slate-100"
                        }`}
                      >
                        <td className="py-4 pr-4 font-medium text-slate-900">
                          {person.name}
                        </td>
                        <td className="py-4 pr-4">
                          {config?.primaryRole ?? "All"}
                        </td>
                        <td className="py-4 pr-4">{config?.level ?? "-"}</td>
                        <td className="py-4 pr-4">
                          {person.isTotal ? "-" : getTargetLabel(person.name)}
                        </td>
                        <td className="py-4 pr-4">{formatNumber(person.fileCount, 0)}</td>
                        <td className="py-4 pr-4">{formatNumber(person.propertySF, 0)}</td>
                        <td className="py-4 pr-4">{formatNumber(person.time, 2)}</td>
                        <td className="py-4 pr-4">
                          {renderMetricChip(person.draftRate, 0, draftTone)}
                        </td>
                        <td className="py-4 pr-4">
                          {renderMetricChip(person.qer, 1, getQERTone(person.qer), "%")}
                        </td>
                        <td className="py-4 pr-4">
                          {renderMetricChip(person.l1, 2, getErrorTone(person.l1))}
                        </td>
                        <td className="py-4 pr-4">
                          {renderMetricChip(person.l2, 2, getErrorTone(person.l2))}
                        </td>
                        <td className="py-4 pr-4">
                          {renderMetricChip(person.l3, 2, getErrorTone(person.l3))}
                        </td>
                        <td className="py-4 pr-4">
                          {person.isTotal ? (
                            <span className="text-xs text-slate-500">Total</span>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                {renderPersonEditor(person.name, "draft")}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDetailPersonName(
                                      detailPersonName === person.name ? null : person.name
                                    )
                                  }
                                  className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
                                >
                                  {detailPersonName === person.name
                                    ? "Ocultar detalle"
                                    : "Ver tiempos"}
                                </button>
                              </div>
                              {detailPersonName === person.name &&
                                renderPersonBreakdown(person.name)}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold">Ranking QA</h3>
                <p className="text-sm text-slate-500">
                  Vista semanal del equipo de QA.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                {rankingQA.length} personas
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-3 pr-4">Nombre</th>
                    <th className="py-3 pr-4">Rol</th>
                    <th className="py-3 pr-4">Nivel</th>
                    <th className="py-3 pr-4">Target</th>
                    <th className="py-3 pr-4">Files</th>
                    <th className="py-3 pr-4">Sqft</th>
                    <th className="py-3 pr-4">Hours</th>
                    <th className="py-3 pr-4">QA Rate</th>
                    <th className="py-3 pr-4">QER %</th>
                    <th className="py-3 pr-4">Editar</th>
                  </tr>
                </thead>
                <tbody>
                  {qaRowsWithTotal.map((person) => {
                    const config = person.isTotal
                      ? null
                      : getPersonConfig(person.name);

                    return (
                      <tr
                        key={person.name}
                        className={`border-b align-top ${
                          person.isTotal
                            ? "border-slate-200 bg-slate-50 font-semibold"
                            : "border-slate-100"
                        }`}
                      >
                        <td className="py-4 pr-4 font-medium text-slate-900">
                          {person.name}
                        </td>
                        <td className="py-4 pr-4">
                          {config?.primaryRole ?? "All"}
                        </td>
                        <td className="py-4 pr-4">{config?.level ?? "-"}</td>
                        <td className="py-4 pr-4">
                          {person.isTotal ? "-" : getTargetLabel(person.name)}
                        </td>
                        <td className="py-4 pr-4">{formatNumber(person.fileCount, 0)}</td>
                        <td className="py-4 pr-4">{formatNumber(person.propertySF, 0)}</td>
                        <td className="py-4 pr-4">{formatNumber(person.time, 2)}</td>
                        <td className="py-4 pr-4">
                          {renderMetricChip(
                            person.qaRate,
                            0,
                            getQAMetricTone(person.qaRate, person.time)
                          )}
                        </td>
                        <td className="py-4 pr-4">
                          {renderMetricChip(person.qer, 1, getQERTone(person.qer), "%")}
                        </td>
                        <td className="py-4 pr-4">
                          {person.isTotal ? (
                            <span className="text-xs text-slate-500">Total</span>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                {renderPersonEditor(person.name, "qa")}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDetailPersonName(
                                      detailPersonName === person.name ? null : person.name
                                    )
                                  }
                                  className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
                                >
                                  {detailPersonName === person.name
                                    ? "Ocultar detalle"
                                    : "Ver tiempos"}
                                </button>
                              </div>
                              {detailPersonName === person.name &&
                                renderPersonBreakdown(person.name)}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
