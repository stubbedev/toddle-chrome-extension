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
 * StudentAttendanceFilters with the full key set the web client sends —
 * the server resolvers destructure these fields unconditionally.
 */
function rangeFilters(
  range: DateRange,
  academicYearIds: string[] | null,
): Record<string, unknown> {
  return {
    startDate: range.startDate,
    endDate: range.endDate,
    isPeriodByAttendance: false,
    courseIds: null,
    periodIds: null,
    showFullDateAttendance: true,
    academicYearIds,
    curriculumProgramIds: null,
    onlyHomeroomAttendance: false,
  };
}

function withCategoryIds(
  range: DateRange,
  academicYearIds: string[] | null,
  categoryV2Ids: string[],
): Record<string, unknown> {
  return { ...rangeFilters(range, academicYearIds), categoryV2Ids };
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

// ---------- year groups & students ----------

export async function fetchYearGroups(
  token: string,
  orgId: string,
): Promise<YearGroup[]> {
  const data = requireData(
    await gql<{ node?: { yearGroups?: YearGroup[] } }>(
      token,
      OPS.yearGroups,
      { id: orgId },
    ),
  );
  return data.node?.yearGroups ?? [];
}

export async function fetchYearGroupStudents(
  token: string,
  yearGroupId: string,
): Promise<StudentRef[]> {
  const data = requireData(
    await gql<{
      node?: { students?: { edges?: { node: StudentRef }[] } };
    }>(token, OPS.yearGroupStudents, { id: yearGroupId }),
  );
  return data.node?.students?.edges?.map((e) => e.node) ?? [];
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
  startDate: string;
  endDate: string;
  isCurrentAcademicYear: boolean;
  isPreviousAcademicYear: boolean;
}

export async function fetchAcademicYears(
  token: string,
  orgId: string,
): Promise<AcademicYear[]> {
  const data = requireData(
    await gql<{
      node?: {
        curriculumPrograms?: { academicYears?: AcademicYear[] }[];
      };
    }>(token, OPS.academicYears, { id: orgId, curriculumIds: null }),
  );
  const seen = new Map<string, AcademicYear>();
  for (const program of data.node?.curriculumPrograms ?? []) {
    for (const year of program.academicYears ?? []) {
      if (!seen.has(year.id)) seen.set(year.id, year);
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

interface EdgeInfo {
  totalCount: number;
  categoryFilteredCount: number;
  percentage: number;
}

interface PresenceOverview {
  totalCount: number;
  presenceNumber: number;
  absenceNumber: number;
  presencePercentage: string;
  absencePercentage: string;
}

interface BatchStudentNode {
  id: string;
  late: { edgeInfo: EdgeInfo } | null;
  absent: { edgeInfo: EdgeInfo } | null;
  overview: { presenceOverview: PresenceOverview } | null;
}

const BATCH_CHUNK = 40;

export async function fetchAttendanceRows(
  token: string,
  students: StudentRef[],
  range: DateRange,
  categories: ResolvedCategories,
  academicYearIds: string[] | null,
): Promise<StudentAttendanceRow[]> {
  const rows: StudentAttendanceRow[] = [];
  for (let offset = 0; offset < students.length; offset += BATCH_CHUNK) {
    const chunk = students.slice(offset, offset + BATCH_CHUNK);
    const res = await gql<Record<string, BatchStudentNode | undefined>>(
      token,
      buildBatchStatsQuery(chunk.map((s) => s.id)),
      {
        filters: rangeFilters(range, academicYearIds),
        lateFilters: withCategoryIds(range, academicYearIds, categories.lateIds),
        absentFilters: withCategoryIds(range, academicYearIds, categories.absentIds),
      },
    );
    const data = res.data ?? {};
    chunk.forEach((student, index) => {
      const node = data[`s${index}`];
      const overview = node?.overview?.presenceOverview;
      rows.push({
        student,
        totalSessions: overview?.totalCount ?? null,
        presenceNumber: overview?.presenceNumber ?? null,
        absenceNumber: overview?.absenceNumber ?? null,
        presencePercentage: num(overview?.presencePercentage),
        absencePercentage: num(overview?.absencePercentage),
        lateCount: node?.late?.edgeInfo?.categoryFilteredCount ?? null,
        latePercentage: node?.late?.edgeInfo?.percentage ?? null,
        absentCount: node?.absent?.edgeInfo?.categoryFilteredCount ?? null,
        absentPercentage: node?.absent?.edgeInfo?.percentage ?? null,
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
  academicYearIds: string[] | null,
): Promise<StudentDetailStats> {
  const data = requireData(
    await gql<{
      node?: {
        firstName: string;
        middleName: string | null;
        lastName: string | null;
        preferredName: string | null;
        attendanceV2?: {
          presenceOverview?: PresenceOverview;
          statistics?: {
            categorySummary?: {
              percentageItems?: {
                percentage: number;
                category: { id: string; label: string; color: string };
              }[];
            };
          };
        }[];
      };
    }>(token, OPS.studentStatsV2, {
      studentId,
      filters: rangeFilters(range, academicYearIds),
      overAllPresenceFilter: rangeFilters(range, academicYearIds),
      isAttendanceLayersEnabled: false,
    }),
  );
  const node = data.node;
  const v2 = node?.attendanceV2?.find((entry) => entry.statistics);
  const overviewEntry = node?.attendanceV2?.find(
    (entry) => entry.presenceOverview,
  );
  const overview = overviewEntry?.presenceOverview;
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
      v2?.statistics?.categorySummary?.percentageItems?.map((item) => ({
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
  academicYearIds: string[] | null,
  first = 100,
): Promise<AttendanceRecord[]> {
  const data = requireData(
    await gql<{
      node?: {
        attendanceV2?: { edges?: { node: AttendanceRecord }[] };
      };
    }>(token, OPS.studentRecords, {
      id: studentId,
      first,
      filters: rangeFilters(range, academicYearIds),
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
