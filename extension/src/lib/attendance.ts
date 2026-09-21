/**
 * Typed toddle attendance data access on top of the verbatim web-client
 * operations (see ./graphql/ops/). Variable names below match the operation
 * signatures exactly — that is the contract.
 */
import { gql, type GqlResponse } from "@/lib/api";
import {
  OPS,
  buildBatchStatsQuery,
  type StudentRef,
  type YearGroup,
} from "@/lib/graphql/documents";

export type { StudentRef, YearGroup } from "@/lib/graphql/documents";

/** yyyy-mm-dd in local time — the format toddle's filters expect. */
export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

/**
 * StudentAttendanceFilters as the web client builds it. Only keys the client
 * actually sends — invented keys (e.g. periodIds) fail variable coercion.
 */
/**
 * StudentAttendanceFilters rebuilt field-for-field from the web client's
 * attendance-summary builder. academicYearIds and curriculumProgramIds are
 * passed as SCALARS (the client passes the selected year/program id
 * directly); the stats resolvers crash on arrays.
 */
function rangeFilters(
  range: DateRange,
  year: AcademicYear | null,
  layers: boolean,
): Record<string, unknown> {
  return {
    startDate: range.startDate,
    endDate: range.endDate,
    isPeriodByAttendance: false,
    courseIds: null,
    periodIds: null,
    showFullDateAttendance: false,
    curriculumProgramIds: year?.curriculumProgramId ?? null,
    academicYearIds: year?.id ?? null,
    onlyHomeroomAttendance: false,
    ...(layers ? { layerTypes: ["DERIVED"] } : {}),
  };
}

/** The minimal overAllPresenceFilter the client builds for presence counts. */
function presenceFilters(
  range: DateRange,
  year: AcademicYear | null,
  layers: boolean,
): Record<string, unknown> {
  return {
    startDate: range.startDate,
    endDate: range.endDate,
    curriculumProgramIds: year?.curriculumProgramId ?? null,
    academicYearIds: year?.id ?? null,
    ...(layers ? { layerTypes: ["DERIVED"] } : {}),
  };
}

function requireData<T>(res: GqlResponse<T>): T {
  if (res.errors?.length) {
    throw new Error(res.errors.map((e) => e.message).join("; "));
  }
  if (!res.data) {
    throw new Error("empty response");
  }
  return res.data;
}

// ---------- cache ----------

const CACHE_TTL_MS = 5 * 60 * 1000;
const REFERENCE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { expires: number; value: unknown }>();

/** Memoize a loader; failures are not cached. */
async function cached<T>(
  key: string,
  loader: () => Promise<T>,
  ttl: number = CACHE_TTL_MS,
): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value as T;
  const value = await loader();
  cache.set(key, { expires: now + ttl, value });
  return value;
}

/** Bypass the cache (header refresh button). */
export function clearAttendanceCache(): void {
  cache.clear();
}

// ---------- year groups & students ----------

export async function fetchYearGroups(
  token: string,
  orgId: string,
): Promise<YearGroup[]> {
  return cached(`yg:${orgId}`, async () =>
    requireData(
      await gql<{ node?: { yearGroups?: YearGroup[] } }>(
        token,
        OPS.yearGroups,
        { id: orgId },
      ),
    ).node?.yearGroups ?? [],
  );
}

export async function fetchYearGroupStudents(
  token: string,
  yearGroupId: string,
): Promise<StudentRef[]> {
  return cached(`ygs:${yearGroupId}`, async () =>
    requireData(
      await gql<{
        node?: { students?: { edges?: { node: StudentRef }[] } };
      }>(token, OPS.yearGroupStudents, { id: yearGroupId }),
    ).node?.students?.edges?.map((e) => e.node) ?? [],
  );
}

// ---------- categories ----------

export interface ResolvedCategories {
  lateIds: string[];
  absentIds: string[];
  all: { id: string; label: string }[];
}

const LATE_RE = /late|tard/i;
const ABSENT_RE = /absent/i;

/**
 * Late/absent category ids from the org's attendance categories, matched by
 * label. toddle orgs name these e.g. "Late"/"Absent"; the ids feed
 * categoryV2Ids filters for edgeInfo.categoryFilteredCount.
 */
export async function fetchResolvedCategories(
  token: string,
  orgId: string,
): Promise<ResolvedCategories> {
  return cached(`cat:${orgId}`, () => loadResolvedCategories(token, orgId));
}

async function loadResolvedCategories(
  token: string,
  orgId: string,
): Promise<ResolvedCategories> {
  const data = requireData(
    await gql<{
      node?: {
        attendanceV2?: {
          attendanceOptionSet?: {
            attendanceCategories?: { id: string; label: string }[];
          };
        };
      };
    }>(token, OPS.attendanceCategories, {
      id: orgId,
      organizationAttendanceFilters: {},
    }),
  );
  const all =
    data.node?.attendanceV2?.attendanceOptionSet?.attendanceCategories ?? [];
  return {
    lateIds: all.filter((c) => LATE_RE.test(c.label)).map((c) => c.id),
    absentIds: all.filter((c) => ABSENT_RE.test(c.label)).map((c) => c.id),
    all,
  };
}

// ---------- academic years ----------

export interface AcademicYear {
  id: string;
  curriculumProgramId: string | null;
  startDate: string;
  endDate: string;
  isCurrentAcademicYear: boolean;
  isPreviousAcademicYear: boolean;
}

export async function fetchAcademicYears(
  token: string,
  orgId: string,
): Promise<AcademicYear[]> {
  return cached(`ay:${orgId}`, () => loadAcademicYears(token, orgId), REFERENCE_TTL_MS);
}

async function loadAcademicYears(
  token: string,
  orgId: string,
): Promise<AcademicYear[]> {
  const data = requireData(
    await gql<{
      node?: {
        curriculumPrograms?: {
          id: string;
          academicYears?: Omit<AcademicYear, "curriculumProgramId">[];
        }[];
      };
    }>(token, OPS.academicYears, { id: orgId, curriculumIds: null }),
  );
  const seen = new Map<string, AcademicYear>();
  for (const program of data.node?.curriculumPrograms ?? []) {
    for (const year of program.academicYears ?? []) {
      if (!seen.has(year.id)) {
        seen.set(year.id, { ...year, curriculumProgramId: program.id });
      }
    }
  }
  return [...seen.values()];
}

/** Current academic year, else the one covering today, else latest. */
export function pickAcademicYear(years: AcademicYear[]): AcademicYear | null {
  return (
    years.find((y) => y.isCurrentAcademicYear) ??
    years.find(
      (y) => y.startDate <= toDateInput(new Date()) && y.endDate >= toDateInput(new Date()),
    ) ??
    years.slice().sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ??
    null
  );
}

// ---------- attendance-layers mode probe ----------

/**
 * Orgs with "attendance layers" (feature flag FeatureFlag:AttendanceLayers)
 * compute attendanceMetric(type: OVERALL) instead of presenceOverview, and
 * add layerTypes: ["DERIVED"] to filters. Probe one field per variant so a
 * classic org never queries attendanceMetric (which 500s without layer
 * context) and a layered org's null presenceOverview falls through to the
 * layers probe.
 */
let cachedLayersMode: boolean | null = null;

const PROBE_CLASSIC = /* GraphQL */ `
  query companionProbeClassic($id: ID!, $f: StudentAttendanceFilters) {
    node(id: $id, type: STUDENT) {
      ... on Student {
        attendanceV2(filters: $f) {
          presenceOverview {
            totalCount
          }
        }
      }
    }
  }
`;

const PROBE_LAYERS = /* GraphQL */ `
  query companionProbeLayers($id: ID!, $f: StudentAttendanceFilters) {
    node(id: $id, type: STUDENT) {
      ... on Student {
        attendanceV2(filters: $f) {
          attendanceMetric(type: OVERALL) {
            totalCount
          }
        }
      }
    }
  }
`;

async function detectLayersMode(
  token: string,
  studentId: string,
  range: DateRange,
  year: AcademicYear | null,
): Promise<boolean> {
  if (cachedLayersMode !== null) return cachedLayersMode;
  const probe = async (query: string, layers: boolean) => {
    const res = await gql<{
      node?: {
        attendanceV2?: {
          presenceOverview?: { totalCount: number } | null;
          attendanceMetric?: { totalCount: number } | null;
        } | null;
      };
    }>(token, query, {
      id: studentId,
      f: rangeFilters(range, year, layers),
    });
    if (res.errors?.length) return null;
    return res.data?.node?.attendanceV2 ?? null;
  };
  try {
    const classic = await probe(PROBE_CLASSIC, false);
    if (classic?.presenceOverview) {
      cachedLayersMode = false;
      return false;
    }
  } catch {
    // classic probe crashed; try layers
  }
  try {
    const layered = await probe(PROBE_LAYERS, true);
    // attendanceMetric exists in every org's schema and can return an empty
    // object in classic orgs — only real counts prove a layered org
    if ((layered?.attendanceMetric?.totalCount ?? 0) > 0) {
      cachedLayersMode = true;
      return true;
    }
  } catch {
    // layers probe crashed too
  }
  cachedLayersMode = false;
  return false;
}

// ---------- batched stats ----------

export interface StudentAttendanceRow {
  student: StudentRef;
  totalSessions: number | null;
  presenceNumber: number | null;
  absenceNumber: number | null;
  presencePercentage: number | null;
  absencePercentage: number | null;
  lateCount: number | null;
  latePercentage: number | null;
  absentCount: number | null;
  absentPercentage: number | null;
}

interface PresenceBlock {
  totalCount: number;
  presencePercentage: string;
  absencePercentage: string;
  presenceNumber: number;
  absenceNumber: number;
}

interface BatchStudentNode {
  id: string;
  overallPresence: {
    presenceOverview: PresenceBlock | null;
    attendanceMetric: PresenceBlock | null;
  } | null;
  stats: {
    edgeInfo: { totalCount: number };
    categorySummary?: {
      percentageItems?: {
        percentage: number;
        category: { id: string; label: string };
      }[];
    };
  } | null;
}

const BATCH_CHUNK = 40;

export async function fetchAttendanceRows(
  token: string,
  yearGroupId: string,
  students: StudentRef[],
  range: DateRange,
  categories: ResolvedCategories,
  year: AcademicYear | null,
): Promise<StudentAttendanceRow[]> {
  const tokenKey = token.slice(-12);
  const yearKey = year?.id ?? "none";
  const catKey = `${categories.lateIds.join(",")}|${categories.absentIds.join(",")}`;
  return cached(
    `rows:${tokenKey}:${yearGroupId}:${yearKey}:${catKey}:${range.startDate}:${range.endDate}`,
    () =>
      loadAttendanceRows(token, students, range, categories, year),
  );
}

async function loadAttendanceRows(
  token: string,
  students: StudentRef[],
  range: DateRange,
  categories: ResolvedCategories,
  year: AcademicYear | null,
): Promise<StudentAttendanceRow[]> {
  if (!students.length) return [];
  const layers = await detectLayersMode(token, students[0].id, range, year);
  const rows: StudentAttendanceRow[] = [];
  for (let offset = 0; offset < students.length; offset += BATCH_CHUNK) {
    const chunk = students.slice(offset, offset + BATCH_CHUNK);
    const res = await gql<Record<string, BatchStudentNode | undefined>>(
      token,
      buildBatchStatsQuery(chunk.map((s) => s.id)),
      {
        filters: rangeFilters(range, year, layers),
        overAllPresenceFilter: presenceFilters(range, year, layers),
        layers,
      },
    );
    const data = res.data ?? {};
    chunk.forEach((student, index) => {
      const node = data[`s${index}`];
      const presence =
        node?.overallPresence?.presenceOverview ??
        node?.overallPresence?.attendanceMetric;
      const items = node?.stats?.categorySummary?.percentageItems ?? [];
      const catPct = (ids: string[]): number | null => {
        const item = items.find((i) => ids.includes(i.category.id));
        return item ? item.percentage : null;
      };
      const total = presence?.totalCount ?? node?.stats?.edgeInfo?.totalCount ?? null;
      const derived = (pct: number | null): number | null =>
        pct !== null && total !== null
          ? Math.round((pct / 100) * total)
          : null;
      const latePct = catPct(categories.lateIds);
      const absentPct = catPct(categories.absentIds);
      rows.push({
        student,
        totalSessions: total,
        presenceNumber: presence?.presenceNumber ?? null,
        absenceNumber: presence?.absenceNumber ?? null,
        presencePercentage: num(presence?.presencePercentage),
        absencePercentage: num(presence?.absencePercentage),
        lateCount: derived(latePct),
        latePercentage: latePct,
        absentCount: derived(absentPct),
        absentPercentage: absentPct,
      });
    });
  }
  return rows;
}

// ---------- student detail (getStudentAttendanceStatisticsV2) ----------

export interface StudentDetailStats {
  student: StudentRef;
  totalCount: number;
  presenceNumber: number | null;
  absenceNumber: number | null;
  presencePercentage: number | null;
  absencePercentage: number | null;
  categoryItems: { id: string; label: string; color: string; percentage: number }[];
}

export async function fetchStudentDetailStats(
  token: string,
  studentId: string,
  range: DateRange,
  year: AcademicYear | null,
): Promise<StudentDetailStats> {
  const yearKey = year?.id ?? "none";
  return cached(`sds:${token.slice(-12)}:${studentId}:${yearKey}:${range.startDate}:${range.endDate}`, () =>
    loadStudentDetailStats(token, studentId, range, year),
  );
}

async function loadStudentDetailStats(
  token: string,
  studentId: string,
  range: DateRange,
  year: AcademicYear | null,
): Promise<StudentDetailStats> {
  const layers = await detectLayersMode(token, studentId, range, year);
  const data = requireData(
    await gql<{
      node?: {
        firstName: string;
        middleName: string | null;
        lastName: string | null;
        preferredName: string | null;
        overallPresence?: {
          presenceOverview?: PresenceBlock | null;
          attendanceMetric?: PresenceBlock | null;
        };
        attendanceV2?: {
          statistics?: {
            courseItems?: unknown[];
            activityItems?: unknown[];
          };
          categorySummary?: {
            percentageItems?: {
              percentage: number;
              category: { id: string; label: string; color: string };
            }[];
          };
        };
      };
    }>(token, OPS.studentStatsV2, {
      studentId,
      filters: rangeFilters(range, year, layers),
      overAllPresenceFilter: presenceFilters(range, year, layers),
      isAttendanceLayersEnabled: layers,
    }),
  );
  const node = data.node;
  const overview =
    node?.overallPresence?.presenceOverview ??
    node?.overallPresence?.attendanceMetric;
  const items = node?.attendanceV2?.categorySummary?.percentageItems ?? [];
  return {
    student: {
      id: studentId,
      firstName: node?.firstName ?? "",
      middleName: node?.middleName ?? null,
      lastName: node?.lastName ?? null,
      preferredName: node?.preferredName ?? null,
    },
    totalCount: overview?.totalCount ?? 0,
    presenceNumber: overview?.presenceNumber ?? null,
    absenceNumber: overview?.absenceNumber ?? null,
    presencePercentage: num(overview?.presencePercentage),
    absencePercentage: num(overview?.absencePercentage),
    categoryItems:
      items.map((item) => ({
        id: item.category.id,
        label: item.category.label,
        color: item.category.color,
        percentage: item.percentage,
      })) ?? [],
  };
}

// ---------- records (geSingletStudentAttendanceRecord) ----------

export interface AttendanceRecord {
  date: string;
  remark: string | null;
  value: {
    id: string;
    label: string;
    color: string;
    status: string;
  } | null;
  course: { id: string; title: string } | null;
  period: { id: string; label: string } | null;
}

export async function fetchStudentRecords(
  token: string,
  studentId: string,
  range: DateRange,
  year: AcademicYear | null,
  first = 100,
): Promise<AttendanceRecord[]> {
  const yearKey = year?.id ?? "none";
  return cached(`rec:${token.slice(-12)}:${studentId}:${yearKey}:${range.startDate}:${range.endDate}:${first}`, () =>
    loadStudentRecords(token, studentId, range, year, first),
  );
}

async function loadStudentRecords(
  token: string,
  studentId: string,
  range: DateRange,
  year: AcademicYear | null,
  first: number,
): Promise<AttendanceRecord[]> {
  const layers = await detectLayersMode(token, studentId, range, year);
  const data = requireData(
    await gql<{
      node?: {
        attendanceV2?: { edges?: { node: AttendanceRecord }[] };
      };
    }>(token, OPS.studentRecords, {
      id: studentId,
      first,
      filters: rangeFilters(range, year, layers),
    }),
  );
  return data.node?.attendanceV2?.edges?.map((e) => e.node) ?? [];
}

// ---------- helpers ----------

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const parsed = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(parsed) ? parsed : null;
}

export function studentDisplayName(s: StudentRef): string {
  return (
    s.preferredName ||
    [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ") ||
    s.id
  );
}
