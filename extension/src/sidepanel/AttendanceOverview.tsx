import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchAcademicYears,
  fetchAttendanceRows,
  fetchResolvedCategories,
  fetchYearGroupStudents,
  fetchYearGroups,
  pickAcademicYear,
  studentDisplayName,
  toDateInput,
  type AcademicYear,
  type DateRange,
  type ResolvedCategories,
  type StudentAttendanceRow,
  type YearGroup,
} from "@/lib/attendance";
import { isRecord, usePersistentState } from "@/lib/persist";
import type { ToddleAuth } from "@/lib/auth";

const SORT_KEYS = ["name", "late", "absent", "presence"] as const;

type SortKey = (typeof SORT_KEYS)[number];

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const isDateRange = (value: unknown): value is DateRange =>
  isRecord(value) &&
  typeof value.startDate === "string" &&
  typeof value.endDate === "string";

const isSortState = (value: unknown): value is SortState =>
  isRecord(value) &&
  typeof value.key === "string" &&
  (SORT_KEYS as readonly string[]).includes(value.key) &&
  (value.dir === "asc" || value.dir === "desc");

interface Props {
  auth: ToddleAuth;
  reloadKey: number;
  onSelectStudent: (
    studentId: string,
    range: DateRange,
    academicYear: AcademicYear | null,
  ) => void;
}

function defaultRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return { startDate: toDateInput(start), endDate: toDateInput(now) };
}

export function AttendanceOverview({ auth, reloadKey, onSelectStudent }: Props) {
  const [yearGroups, setYearGroups] = useState<YearGroup[] | null>(null);
  const [yearGroupId, setYearGroupId] = usePersistentState(
    "grade",
    "",
    (value): value is string => typeof value === "string",
  );
  const [range, setRange] = usePersistentState(
    "range",
    defaultRange(),
    isDateRange,
  );
  const [rows, setRows] = useState<StudentAttendanceRow[] | null>(null);
  const [academicYear, setAcademicYear] = useState<AcademicYear | null>(null);
  const [sort, setSort] = usePersistentState<SortState>(
    "sort",
    { key: "late", dir: "desc" },
    isSortState,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setYearGroups(null);
    fetchYearGroups(auth.token, auth.orgId ?? "")
      .then((groups) => {
        if (cancelled) return;
        setYearGroups(groups);
        setYearGroupId((current) =>
          groups.some((yg) => yg.id === current) ? current : groups[0]?.id ?? "",
        );
      })
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [auth.token, auth.orgId, setYearGroupId]);

  useEffect(() => {
    if (!yearGroupId) return;
    let cancelled = false;
    setError(null);
    setRows(null);
    (async () => {
      const categories: ResolvedCategories = await fetchResolvedCategories(
        auth.token,
        auth.orgId ?? "",
      );
      const years: AcademicYear[] = await fetchAcademicYears(
        auth.token,
        auth.orgId ?? "",
      );
      const year = pickAcademicYear(years);
      setAcademicYear(year);
      const students = await fetchYearGroupStudents(auth.token, yearGroupId);
      const data = await fetchAttendanceRows(
        auth.token,
        yearGroupId,
        students,
        range,
        categories,
        year,
      );
      if (!cancelled) setRows(data);
    })().catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [auth.token, auth.orgId, yearGroupId, range, reloadKey]);

  const sorted = useMemo(() => sortRows(rows ?? [], sort), [rows, sort]);
  const selectedGroup =
    yearGroups?.find((yg) => yg.id === yearGroupId) ?? null;
  const selectedLabel = selectedGroup
    ? [selectedGroup.grade?.name, selectedGroup.name].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-2.5 pt-4">
          <div className="space-y-1">
            <Label htmlFor="grade">Grade level</Label>
            <Select
              value={yearGroupId}
              onValueChange={(id) => id && setYearGroupId(id)}
              disabled={!yearGroups}
            >
              <SelectTrigger id="grade" className="w-full">
                <span className="truncate">
                  {selectedLabel ?? (yearGroups ? "Select grade" : "Loading…")}
                </span>
              </SelectTrigger>
              <SelectContent>
                {(yearGroups ?? []).map((yg) => (
                  <SelectItem key={yg.id} value={yg.id}>
                    {[yg.grade?.name, yg.name].filter(Boolean).join(" · ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="from">
                <CalendarDays className="mr-1 inline size-3" /> From
              </Label>
              <Input
                id="from"
                type="date"
                value={range.startDate}
                onChange={(e) =>
                  setRange((r) => ({ ...r, startDate: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                value={range.endDate}
                onChange={(e) =>
                  setRange((r) => ({ ...r, endDate: e.target.value }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>
      {error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-destructive">
              Failed to load
            </CardTitle>
            <CardDescription className="break-words">{error}</CardDescription>
          </CardHeader>
        </Card>
      )}
      {rows === null && !error && <TableSkeleton />}
      {rows !== null && (
        <StudentTable
          rows={sorted}
          sort={sort}
          onSort={setSort}
          onSelectStudent={(studentId) =>
            onSelectStudent(studentId, range, academicYear)
          }
        />
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

function sortRows(rows: StudentAttendanceRow[], sort: SortState) {
  const dir = sort.dir === "asc" ? 1 : -1;
  const value = (row: StudentAttendanceRow): number | string => {
    switch (sort.key) {
      case "name":
        return studentDisplayName(row.student);
      case "absent":
        return row.absentCount ?? 0;
      case "presence":
        return row.presencePercentage ?? 0;
      case "late":
      default:
        return row.lateCount ?? 0;
    }
  };
  const copy = [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === "string" || typeof vb === "string") {
      return String(va).localeCompare(String(vb)) * dir;
    }
    return (va - vb) * dir;
  });
  return copy;
}

function SortableHead(props: {
  label: string;
  column: SortKey;
  sort: SortState;
  onSort: (sort: SortState) => void;
  className?: string;
}) {
  const { label, column, sort, onSort, className } = props;
  const active = sort.key === column;
  const Icon = !active
    ? ArrowUpDown
    : sort.dir === "desc"
      ? ArrowDown
      : ArrowUp;
  const toggle = () => {
    if (active) {
      onSort({ key: column, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSort({ key: column, dir: column === "name" ? "asc" : "desc" });
    }
  };
  return (
    <TableHead className={`h-8 text-xs ${className ?? ""}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={toggle}
      >
        {label}
        <Icon className="size-3" />
      </button>
    </TableHead>
  );
}

function StudentTable(props: {
  rows: StudentAttendanceRow[];
  sort: SortState;
  onSort: (sort: SortState) => void;
  onSelectStudent: (studentId: string) => void;
}) {
  const { rows, sort, onSort, onSelectStudent } = props;
  return (
    <Card>
      <CardContent className="px-2 pb-2 pt-3">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label="Student"
                column="name"
                sort={sort}
                onSort={onSort}
              />
              <SortableHead
                label="Late"
                column="late"
                sort={sort}
                onSort={onSort}
                className="text-right"
              />
              <SortableHead
                label="Absent"
                column="absent"
                sort={sort}
                onSort={onSort}
                className="text-right"
              />
              <SortableHead
                label="Pres."
                column="presence"
                sort={sort}
                onSort={onSort}
                className="text-right"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.student.id}
                className="cursor-pointer"
                onClick={() => onSelectStudent(row.student.id)}
              >
                <TableCell className="py-1.5 pr-2 text-xs font-medium">
                  {studentDisplayName(row.student)}
                </TableCell>
                <TableCell className="py-1.5 text-right text-xs">
                  <CountCell
                    count={row.lateCount}
                    percentage={row.latePercentage}
                  />
                </TableCell>
                <TableCell className="py-1.5 text-right text-xs">
                  <CountCell
                    count={row.absentCount}
                    percentage={row.absentPercentage}
                  />
                </TableCell>
                <TableCell className="py-1.5 text-right text-xs">
                  {row.presencePercentage !== null
                    ? `${Math.round(row.presencePercentage)}%`
                    : "–"}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-4 text-center text-xs text-muted-foreground"
                >
                  No students found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CountCell(props: { count: number | null; percentage: number | null }) {
  const { count, percentage } = props;
  if (count === null) return <span className="text-muted-foreground">–</span>;
  return (
    <span>
      {count}
      {percentage !== null && percentage > 0 && (
        <span className="ml-1 text-[10px] text-muted-foreground">
          {Math.round(percentage)}%
        </span>
      )}
    </span>
  );
}

export function BackButton(props: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" {...props}>
      <ArrowLeft className="size-4" /> Back
    </Button>
  );
}

export function RefreshButton(props: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label="Refresh" {...props}>
      <RefreshCw className="size-4" />
    </Button>
  );
}
