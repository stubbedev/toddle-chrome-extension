import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, RefreshCw } from "lucide-react";
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
  SelectValue,
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
import type { ToddleAuth } from "@/lib/auth";

type SortKey = "name" | "late" | "absent" | "presence";

interface Props {
  auth: ToddleAuth;
  onSelectStudent: (studentId: string, range: DateRange, academicYearIds: string[] | null) => void;
}

function defaultRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return { startDate: toDateInput(start), endDate: toDateInput(now) };
}

export function AttendanceOverview({ auth, onSelectStudent }: Props) {
  const [yearGroups, setYearGroups] = useState<YearGroup[] | null>(null);
  const [yearGroupId, setYearGroupId] = useState<string>("");
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [rows, setRows] = useState<StudentAttendanceRow[] | null>(null);
  const [academicYearIds, setAcademicYearIds] = useState<string[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("late");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setYearGroups(null);
    fetchYearGroups(auth.token, auth.orgId ?? "")
      .then((groups) => {
        if (cancelled) return;
        setYearGroups(groups);
        setYearGroupId(groups[0]?.id ?? "");
      })
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [auth.token, auth.orgId]);

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
      const years: AcademicYear[] = await fetchAcademicYears(auth.token, auth.orgId ?? "");
      const year = pickAcademicYear(years);
      setAcademicYearIds(year ? [year.id] : null);
      const students = await fetchYearGroupStudents(auth.token, yearGroupId);
      const data = await fetchAttendanceRows(
        auth.token,
        students,
        range,
        categories,
        year ? [year.id] : null,
      );
      if (!cancelled) setRows(data);
    })().catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [auth.token, auth.orgId, yearGroupId, range]);

  const sorted = useMemo(() => sortRows(rows ?? [], sortKey), [rows, sortKey]);

  return (
    <div className="space-y-3">
      <Filters
        yearGroups={yearGroups}
        yearGroupId={yearGroupId}
        onYearGroupChange={setYearGroupId}
        range={range}
        onRangeChange={setRange}
        sortKey={sortKey}
        onSortKeyChange={setSortKey}
      />
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
          onSelectStudent={(studentId) =>
            onSelectStudent(studentId, range, academicYearIds)
          }
        />
      )}
    </div>
  );
}

function Filters(props: {
  yearGroups: YearGroup[] | null;
  yearGroupId: string;
  onYearGroupChange: (id: string) => void;
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
}) {
  const {
    yearGroups,
    yearGroupId,
    onYearGroupChange,
    range,
    onRangeChange,
    sortKey,
    onSortKeyChange,
  } = props;
  const setRangePart = useCallback(
    (part: keyof DateRange, value: string) =>
      onRangeChange({ ...range, [part]: value }),
    [range, onRangeChange],
  );
  return (
    <Card>
      <CardContent className="space-y-2.5 pt-4">
        <div className="space-y-1">
          <Label htmlFor="grade">Grade level</Label>
          <Select
            value={yearGroupId}
            onValueChange={(id) => id && onYearGroupChange(id)}
            disabled={!yearGroups}
          >
            <SelectTrigger id="grade" className="w-full">
              <SelectValue
                placeholder={yearGroups ? "Select grade" : "Loading…"}
              />
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
              onChange={(e) => setRangePart("startDate", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="date"
              value={range.endDate}
              onChange={(e) => setRangePart("endDate", e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Sort by</Label>
          <Select
            value={sortKey}
            onValueChange={(v) => v && onSortKeyChange(v as SortKey)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="late">Late (most first)</SelectItem>
              <SelectItem value="absent">Absences (most first)</SelectItem>
              <SelectItem value="presence">Presence % (lowest first)</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
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

function sortRows(rows: StudentAttendanceRow[], key: SortKey) {
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (key) {
      case "name":
        return studentDisplayName(a.student).localeCompare(
          studentDisplayName(b.student),
        );
      case "absent":
        return (b.absentCount ?? 0) - (a.absentCount ?? 0);
      case "presence":
        return (a.presencePercentage ?? 101) - (b.presencePercentage ?? 101);
      case "late":
      default:
        return (b.lateCount ?? 0) - (a.lateCount ?? 0);
    }
  });
  return copy;
}

function StudentTable(props: {
  rows: StudentAttendanceRow[];
  onSelectStudent: (studentId: string) => void;
}) {
  const { rows, onSelectStudent } = props;
  return (
    <Card>
      <CardContent className="px-2 pb-2 pt-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 text-xs">Student</TableHead>
              <TableHead className="h-8 text-right text-xs">Late</TableHead>
              <TableHead className="h-8 text-right text-xs">Absent</TableHead>
              <TableHead className="h-8 text-right text-xs">Pres.</TableHead>
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
