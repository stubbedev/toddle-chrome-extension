/**
 * Typed toddle attendance data access. Queries live in ./graphql/documents.ts.
 */
import { gql, type GqlResponse } from "@/lib/api";
import {
  ATTENDANCE_CATEGORIES_QUERY,
  STUDENT_DETAIL_STATS_QUERY,
  STUDENT_RECORDS_QUERY,
  YEAR_GROUP_STUDENTS_QUERY,
  YEAR_GROUPS_QUERY,
  buildBatchStatsQuery,
  type StudentRef,
  type YearGroup,
} from "@/lib/graphql/documents";

export type { YearGroup, StudentRef } from "@/lib/graphql/documents";

/** yyyy-mm-dd in local time — the format toddle's filters expect. */
export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** Filters shape as built by the web client's attendance-summary page. */
function baseFilters(range: DateRange): Record<string, unknown> {
  return {
    startDate: range.startDate,
    endDate: range.endDate,
    showFullDateAttendance: true,
  };
}

/**
 * Category ids to filter by. The web client sends one of categoryIds /
 * categoryV2Ids / optionIds depending on feature flags; the server input
 * accepts all three keys, so we send the same ids everywhere.
 */
function categoryFilters(
  range: DateRange,
  ids: string[],
): Record<string, unknown> {
  return {
    ...baseFilters(range),
    categoryIds: ids,
    categoryV2Ids: ids,
    optionIds: ids,
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

// ---------- year groups & students ----------

export async function fetchYearGroups(
  token: string,
  orgId: string,
): Promise<YearGroup[]> {
  const data = requireData(
    await gql<{ node?: { yearGroups?: YearGroup[] } }>(
      token,
      YEAR_GROUPS_QUERY,
      { orgId },
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
    }>(token, YEAR_GROUP_STUDENTS_QUERY, { yearGroupId }),
  );
  return data.node?.students?.edges?.map((e) => e.node) ?? [];
}

// ---------- categories ----------

export interface AttendanceOptionInfo {
  id: string;
  label: string;
  status: string;
}

export interface ResolvedCategories {
  /** Option/category ids whose status or label says "late". */
  lateIds: string[];
  absentIds: string[];
  options: AttendanceOptionInfo[];
}

const LATE_RE = /late|tard/i;
const ABSENT_RE = /absent/i;

export async function fetchResolvedCategories(
  token: string,
  orgId: string,
): Promise<ResolvedCategories> {
  interface CategoryWithOptions {
    id: string;
    label: string;
    attendanceOptions?: AttendanceOptionInfo[];
  }
  const data = requireData(
    await gql<{
      node?: {
        attendanceV2?: {
          attendanceOptionSet?: {
            attendanceCategories?: CategoryWithOptions[];
          };
        };
      };
    }>(token, ATTENDANCE_CATEGORIES_QUERY, { orgId, filters: {} }),
  );
  const categories =
    data.node?.attendanceV2?.attendanceOptionSet?.attendanceCategories ?? [];
  const lateIds: string[] = [];
  const absentIds: string[] = [];
  const options: AttendanceOptionInfo[] = [];
  for (const category of categories) {
    const opts = category.attendanceOptions ?? [];
    if (opts.length) {
      for (const opt of opts) {
        options.push(opt);
        if (LATE_RE.test(opt.status) || LATE_RE.test(opt.label)) {
          lateIds.push(opt.id);
        }
        if (ABSENT_RE.test(opt.status) || ABSENT_RE.test(opt.label)) {
          absentIds.push(opt.id);
        }
      }
    } else {
      options.push({ id: category.id, label: category.label, status: "" });
      if (LATE_RE.test(category.label)) lateIds.push(category.id);
      if (ABSENT_RE.test(category.label)) absentIds.push(category.id);
    }
  }
  return { lateIds, absentIds, options };
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
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  preferredName: string | null;
  stats: { edgeInfo: { totalCount: number }; presenceOverview: PresenceOverview };
  late: { edgeInfo: EdgeInfo } | null;
  absent: { edgeInfo: EdgeInfo } | null;
}

const BATCH_CHUNK = 40;

export async function fetchAttendanceRows(
  token: string,
  students: StudentRef[],
  range: DateRange,
  categories: ResolvedCategories,
): Promise<StudentAttendanceRow[]> {
  const rows: StudentAttendanceRow[] = [];
  for (let offset = 0; offset < students.length; offset += BATCH_CHUNK) {
    const chunk = students.slice(offset, offset + BATCH_CHUNK);
    const data = requireData(
      await gql<Record<string, BatchStudentNode | undefined>>(
        token,
        buildBatchStatsQuery(chunk.map((s) => s.id)),
        {
          filters: baseFilters(range),
          lateFilters: categoryFilters(range, categories.lateIds),
          absentFilters: categoryFilters(range, categories.absentIds),
        },
      ),
    );
    chunk.forEach((student, index) => {
      const node = data[`s${index}`];
      const overview = node?.stats?.presenceOverview;
      const num = (v: string | number | null | undefined): number | null => {
        if (v === null || v === undefined) return null;
        const parsed = typeof v === "number" ? v : Number.parseFloat(v);
        return Number.isFinite(parsed) ? parsed : null;
      };
      rows.push({
        student: node ?? student,
        totalSessions: node?.stats.edgeInfo.totalCount ?? null,
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

// ---------- student detail ----------

export interface StudentDetailStats {
  student: StudentRef & { email: string | null };
  totalCount: number;
  percentage: number | null;
  presenceNumber: number | null;
  absenceNumber: number | null;
  presencePercentage: number | null;
  absencePercentage: number | null;
  categoryItems: { id: string; label: string; percentage: number }[];
}

export async function fetchStudentDetailStats(
  token: string,
  studentId: string,
  range: DateRange,
): Promise<StudentDetailStats> {
  const data = requireData(
    await gql<{
      node?: {
        firstName: string;
        middleName: string | null;
        lastName: string | null;
        preferredName: string | null;
        email: string | null;
        attendanceV2?: {
          edgeInfo: { totalCount: number; percentage: number };
          presenceOverview: PresenceOverview;
          statistics?: {
            categoryItems?: {
              percentage: number;
              item: { id: string; label: string };
            }[];
          };
        };
      };
    }>(token, STUDENT_DETAIL_STATS_QUERY, {
      studentId,
      filters: baseFilters(range),
    }),
  );
  const node = data.node;
  const v2 = node?.attendanceV2;
  return {
    student: {
      id: studentId,
      firstName: node?.firstName ?? "",
      middleName: node?.middleName ?? null,
      lastName: node?.lastName ?? null,
      preferredName: node?.preferredName ?? null,
      email: node?.email ?? null,
    },
    totalCount: v2?.edgeInfo.totalCount ?? 0,
    percentage: v2?.edgeInfo.percentage ?? null,
    presenceNumber: v2?.presenceOverview?.presenceNumber ?? null,
    absenceNumber: v2?.presenceOverview?.absenceNumber ?? null,
    presencePercentage: v2 ? num(v2.presenceOverview?.presencePercentage) : null,
    absencePercentage: v2 ? num(v2.presenceOverview?.absencePercentage) : null,
    categoryItems:
      v2?.statistics?.categoryItems?.map((c) => ({
        id: c.item.id,
        label: c.item.label,
        percentage: c.percentage,
      })) ?? [],
  };
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const parsed = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface AttendanceRecord {
  date: string;
  status: string;
  remark: string | null;
  isHomeroomAttendance: boolean;
  value: { label: string; status: string; color: string } | null;
  course: { title: string } | null;
  period: { label: string; startTime: string } | null;
}

export async function fetchStudentRecords(
  token: string,
  studentId: string,
  range: DateRange,
  first = 100,
): Promise<AttendanceRecord[]> {
  const data = requireData(
    await gql<{
      node?: {
        attendanceV2?: { edges?: { node: AttendanceRecord }[] };
      };
    }>(token, STUDENT_RECORDS_QUERY, {
      studentId,
      first,
      filters: baseFilters(range),
    }),
  );
  return data.node?.attendanceV2?.edges?.map((e) => e.node) ?? [];
}

// ---------- display helpers ----------

export function studentDisplayName(s: StudentRef): string {
  return (
    s.preferredName ||
    [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ") ||
    s.id
  );
}
