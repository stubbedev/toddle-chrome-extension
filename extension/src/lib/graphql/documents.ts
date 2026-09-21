/**
 * GraphQL documents for attendance, derived from the toddle web client
 * (see ../../graphql/operations/ for the originals).
 */

export const STUDENT_NAME_FIELDS = /* GraphQL */ `
  fragment studentNameFields on Student {
    firstName
    middleName
    lastName
    preferredName
  }
`;

export interface YearGroup {
  id: string;
  name: string;
  grade: { id: string; name: string } | null;
}

export const YEAR_GROUPS_QUERY = /* GraphQL */ `
  query companionYearGroups($orgId: ID!) {
    node(id: $orgId, type: ORGANIZATION) {
      id
      ... on Organization {
        id
        yearGroups {
          id
          name
          grade {
            id
            name
          }
        }
      }
    }
  }
`;

export interface StudentRef {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  preferredName: string | null;
}

export const YEAR_GROUP_STUDENTS_QUERY = /* GraphQL */ `
  query companionYearGroupStudents($yearGroupId: ID!) {
    node(id: $yearGroupId, type: YEAR_GROUP) {
      id
      ... on YearGroup {
        id
        name
        students {
          totalCount
          edges {
            node {
              id
              firstName
              middleName
              lastName
              preferredName
            }
          }
        }
      }
    }
  }
`;

export interface AttendanceCategory {
  id: string;
  label: string;
}

export const ATTENDANCE_CATEGORIES_QUERY = /* GraphQL */ `
  query companionAttendanceCategories($orgId: ID!, $filters: OrganizationAttendanceFilters) {
    node(id: $orgId, type: ORGANIZATION) {
      id
      ... on Organization {
        attendanceV2(filters: $filters) {
          attendanceOptionSet {
            id
            attendanceCategories {
              id
              label
              attendanceOptions {
                id
                label
                status
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Per-student attendance stats, batched over many students with aliases.
 * `stats` carries the overall numbers; `late`/`absent` use category-filtered
 * edgeInfo for exact counts and percentages.
 */
export function buildBatchStatsQuery(studentIds: string[]): string {
  const selections = studentIds
    .map((id, index) => {
      const alias = `s${index}`;
      return /* GraphQL */ `
      ${alias}: node(id: "${id}", type: STUDENT) {
        ... on Student {
          id
          ...studentNameFields
          stats: attendanceV2(filters: $filters) {
            edgeInfo {
              totalCount
            }
            presenceOverview {
              totalCount
              presenceNumber
              absenceNumber
              presencePercentage
              absencePercentage
            }
          }
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
        }
      }`;
    })
    .join("\n");

  return /* GraphQL */ `
    query companionBatchStats(
      $filters: StudentAttendanceFilters
      $lateFilters: StudentAttendanceFilters
      $absentFilters: StudentAttendanceFilters
    ) {
      ${selections}
    }
    ${STUDENT_NAME_FIELDS}
  `;
}

export const STUDENT_DETAIL_STATS_QUERY = /* GraphQL */ `
  query companionStudentDetailStats(
    $studentId: ID!
    $filters: StudentAttendanceFilters
  ) {
    node(id: $studentId, type: STUDENT) {
      id
      ... on Student {
        id
        ...studentNameFields
        email
        attendanceV2(filters: $filters) {
          edgeInfo {
            totalCount
            percentage
          }
          presenceOverview {
            totalCount
            presenceNumber
            absenceNumber
            presencePercentage
            absencePercentage
          }
          statistics {
            categoryItems {
              percentage
              item {
                id
                label
              }
            }
          }
        }
      }
    }
  }
  ${STUDENT_NAME_FIELDS}
`;

export const STUDENT_RECORDS_QUERY = /* GraphQL */ `
  query companionStudentRecords(
    $studentId: ID!
    $first: Int
    $after: String
    $filters: StudentAttendanceFilters
  ) {
    node(id: $studentId, type: STUDENT) {
      id
      ... on Student {
        attendanceV2(first: $first, after: $after, filters: $filters) {
          edges {
            node {
              date
              status
              remark
              isHomeroomAttendance
              value {
                label
                status
                color
              }
              course {
                title
              }
              period {
                label
                startTime
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;
