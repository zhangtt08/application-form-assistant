import type { PlatformFamilyRecord, RealIssue, RealValidationSession, TrustLevel } from "./types";
import type { StorageLike } from "../workspace/jobRepository";

/**
 * Pilot Repository（spec 第五/七/三十一章）：RealValidationSession / RealIssue / PlatformFamily
 * 存储于 afa.realvalidation.v1；本地 JSON，无后端。
 */

const KEY = "afa.realvalidation.v1";

export interface PilotStorage {
  sessions: RealValidationSession[];
  issues: RealIssue[];
  platformFamilies: PlatformFamilyRecord[];
}

let storage: StorageLike = {
  async get(key) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return {};
    const res = await chrome.storage.local.get(key);
    return res as Record<string, unknown>;
  },
  async set(key, value) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [key]: value });
  },
};

export function setPilotStorageBackend(backend: StorageLike): void {
  storage = backend;
}

export function emptyPilotStorage(): PilotStorage {
  return { sessions: [], issues: [], platformFamilies: [] };
}

export async function loadPilot(): Promise<PilotStorage> {
  const raw = await storage.get(KEY);
  const rec = raw[KEY] as PilotStorage | undefined;
  return rec && Array.isArray(rec.sessions) ? rec : emptyPilotStorage();
}

async function savePilot(data: PilotStorage): Promise<void> {
  await storage.set(KEY, data);
}

export function newSessionId(): string {
  return `rvs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newIssueId(): string {
  return `ri_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Platform Fingerprint（spec 第二十章）：hostname 主域 + 首段路径 → 粗粒度 family */
export function derivePlatformFamily(hostname: string, pathname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  // 主域 = 倒数第二段（.co.uk 等简化处理——Pilot 场景足够）
  const main = parts.length >= 2 ? parts[parts.length - 2]! : host;
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  // 常见 ATS 路径特征
  const ATS_HINTS: [RegExp, string][] = [
    [/^(ats|apply|career|careers|job|jobs|recruit|recruitment|moka|beisen|zhaopin|liepin|boss|position|portal)/i, "ats"],
  ];
  for (const [re, tag] of ATS_HINTS) {
    if (re.test(seg)) return `${main}-${tag}`;
  }
  return main;
}

export async function saveSession(session: RealValidationSession): Promise<void> {
  const data = await loadPilot();
  const idx = data.sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) data.sessions[idx] = session;
  else data.sessions.unshift(session);
  await updatePlatformFamily(session.platformFamily, session.hostname);
  await savePilot(data);
}

export async function listSessions(): Promise<RealValidationSession[]> {
  return (await loadPilot()).sessions;
}

export async function addIssue(issue: RealIssue): Promise<void> {
  const data = await loadPilot();
  data.issues.unshift(issue);
  await savePilot(data);
}

export async function updateIssueStatus(issueId: string, status: RealIssue["status"]): Promise<void> {
  const data = await loadPilot();
  const issue = data.issues.find((i) => i.issueId === issueId);
  if (issue) {
    issue.status = status;
    await savePilot(data);
  }
}

export async function listIssues(): Promise<RealIssue[]> {
  return (await loadPilot()).issues;
}

async function updatePlatformFamily(family: string, hostname: string): Promise<void> {
  const data = await loadPilot();
  let rec = data.platformFamilies.find((p) => p.family === family);
  if (!rec) {
    rec = { family, hostnamePatterns: [], trustLevel: "unverified", pagesTested: 0, lastTestedAt: null, unresolvedP0P1: 0 };
    data.platformFamilies.push(rec);
  }
  if (!rec.hostnamePatterns.includes(hostname)) rec.hostnamePatterns.push(hostname);
  rec.pagesTested += 1;
  rec.lastTestedAt = new Date().toISOString();
}

/** Trust Level（spec 三十一章）：verified = ≥2 页面通过且 False Fill=0 且无未解决 P0/P1 */
export function computeTrustLevel(rec: PlatformFamilyRecord, sessions: RealValidationSession[], issues: RealIssue[]): TrustLevel {
  const familySessions = sessions.filter((s) => s.platformFamily === rec.family);
  const passed = familySessions.filter((s) => s.semanticFalseFills === 0).length;
  const unresolved = issues.filter(
    (i) => i.hostname && rec.hostnamePatterns.some((h) => i.hostname === h) && (i.severity === "P0" || i.severity === "P1") && i.status !== "fixed" && i.status !== "verified" && i.status !== "wont_fix",
  ).length;
  if (passed >= 2 && unresolved === 0) return "verified";
  if (familySessions.length > 0) return "experimental";
  return "unverified";
}

export async function getPlatformTrust(platformFamily: string): Promise<TrustLevel> {
  const data = await loadPilot();
  const rec = data.platformFamilies.find((p) => p.family === platformFamily);
  if (!rec) return "unverified";
  return computeTrustLevel(rec, data.sessions, data.issues);
}

/** Real Compatibility Report v1（spec 二十二章）：只统计真实数据，空数据如实为 0 */
export interface RealReport {
  testedPages: number;
  platformFamilies: number;
  fieldCount: number;
  actualFieldCount: number;
  detectionRecall: number | null;
  writeSuccessRate: number | null;
  manualFallbackRate: number | null;
  falseFillCount: number;
  issuesBySeverity: Record<string, number>;
}

export function summarizeRealReport(data: PilotStorage): RealReport {
  const sessions = data.sessions;
  const detected = sessions.reduce((s, x) => s + x.detectedFields, 0);
  const actual = sessions.reduce((s, x) => s + (x.actualFieldCount ?? 0), 0);
  const writable = sessions.reduce((s, x) => s + x.writableFields, 0);
  const manual = sessions.reduce((s, x) => s + x.manualFields, 0);
  const falseFills = sessions.reduce((s, x) => s + x.semanticFalseFills, 0);
  const bySeverity: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const i of data.issues) bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
  return {
    testedPages: sessions.length,
    platformFamilies: new Set(sessions.map((s) => s.platformFamily)).size,
    fieldCount: detected,
    actualFieldCount: actual,
    detectionRecall: actual > 0 ? Number((detected / actual).toFixed(3)) : null,
    writeSuccessRate: writable + manual > 0 ? Number((writable / (writable + manual)).toFixed(3)) : null,
    manualFallbackRate: detected > 0 ? Number((manual / detected).toFixed(3)) : null,
    falseFillCount: falseFills,
    issuesBySeverity: bySeverity,
  };
}

/** pilot-log.md 行（spec 三十五章） */
export function pilotLogLine(s: RealValidationSession): string {
  const issues = s.issues.length > 0 ? `${s.issues.length} issues` : "clean";
  return `| ${s.testedAt.slice(0, 10)} | ${s.platformFamily} | ${s.hostname} | ${s.detectedFields} | ${issues} |`;
}
