/**
 * GraphQL documents.
 *
 * Everything in ./ops/ is exported VERBATIM from the toddle web client
 * (scripts/export_extension_ops.py) — operation signature, arguments and
 * fragment closure are exactly what the web app ships, so server-side
 * validation quirks (required filter objects, connection shapes) are
 * inherited from working code instead of hand-rolled.
 *
 * The only composed document is BATCH_STATS_TEMPLATE, whose selections are
 * copied verbatim from getStudentAttendanceRecord / getStudentOverallPresenceCount
 * and simply aliased per student.
 */
import getAllStudentOfYearGroupQuery from "./ops/getAllStudentOfYearGroupQuery.graphql?raw";
import getOrganizationAttendanceCategories from "./ops/getOrganizationAttendanceCategories.graphql?raw";
import getOrganizationYearGroups from "./ops/getOrganizationYearGroups.graphql?raw";
import getStudentAttendanceStatisticsV2 from "./ops/getStudentAttendanceStatisticsV2.graphql?raw";
import getStudentOverallPresenceCount from "./ops/getStudentOverallPresenceCount.graphql?raw";
import geSingletStudentAttendanceRecord from "./ops/geSingletStudentAttendanceRecord.graphql?raw";
import getSchoolAcademicYears from "./ops/getSchoolAcademicYears.graphql?raw";

export const OPS = {
  yearGroups: getOrganizationYearGroups,
  yearGroupStudents: getAllStudentOfYearGroupQuery,
  attendanceCategories: getOrganizationAttendanceCategories,
  overallPresenceCount: getStudentOverallPresenceCount,
  studentStatsV2: getStudentAttendanceStatisticsV2,
  studentRecords: geSingletStudentAttendanceRecord,
  academicYears: getSchoolAcademicYears,
} as const;

/**
 * Per-student stats batched with aliases. Selections are verbatim from the
 * web client: `edgeInfo` from getStudentAttendanceRecord, `presenceOverview`
 * from getStudentOverallPresenceCount.
 */
const BATCH_SELECTION = `
        late: attendanceV2(filters: $lateFilters) {
          edgeInfo {
            totalCount
            categoryFilteredCount
            percentage
          }
        }
        absent: attendanceV2(filters: $absentFilters) {
          edgeInfo {
            totalCount
            categoryFilteredCount
            percentage
          }
        }
        overview: attendanceV2(filters: $filters) {
          presenceOverview {
            totalCount
            presencePercentage
            absencePercentage
            presenceNumber
            absenceNumber
          }
        }`;

export function buildBatchStatsQuery(studentIds: string[]): string {
  const selections = studentIds
    .map((id, index) => `  s${index}: node(id: "${id}", type: STUDENT) {
      id
      ... on Student {
${BATCH_SELECTION}
      }
    }`)
    .join("\n");
  return `query companionBatchStats($filters: StudentAttendanceFilters, $lateFilters: StudentAttendanceFilters, $absentFilters: StudentAttendanceFilters) {
${selections}
}`;
}

export interface YearGroup {
  id: string;
  name: string;
  grade: { id: string; name: string } | null;
}

export interface StudentRef {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  preferredName: string | null;
}
