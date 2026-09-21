import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
  fetchStudentDetailStats,
  fetchStudentRecords,
  studentDisplayName,
  type AcademicYear,
  type AttendanceRecord,
  type DateRange,
  type StudentDetailStats,
} from "@/lib/attendance";
import { BackButton } from "@/sidepanel/AttendanceOverview";
import type { ToddleAuth } from "@/lib/auth";

interface Props {
  auth: ToddleAuth;
  studentId: string;
  range: DateRange;
  academicYear: AcademicYear | null;
  onBack: () => void;
}

export function StudentDetail({ auth, studentId, range, academicYear, onBack }: Props) {
  const [stats, setStats] = useState<StudentDetailStats | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setStats(null);
    setRecords(null);
    (async () => {
      const [stats, records, statsError, recordsError] = await Promise.all([
        fetchStudentDetailStats(auth.token, studentId, range, academicYear)
          .then((v) => [v, null] as const)
          .catch((e: unknown) => [null, String(e)] as const),
        fetchStudentRecords(auth.token, studentId, range, academicYear)
          .then((v) => [v, null] as const)
          .catch((e: unknown) => [null, String(e)] as const),
      ]).then(([s, r]) => [s[0], r[0], s[1], r[1]] as const);
      if (cancelled) return;
      setStats(stats);
      setRecords(records);
      setError(statsError ?? recordsError);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.token, studentId, range, academicYear]);

  return (
    <div className="space-y-3">
      <div>
        <BackButton onClick={onBack} />
      </div>
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
      {!stats && !error && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      )}
      {stats && <DetailCards stats={stats} range={range} />}
      {records !== null && <RecordsCard records={records} />}
    </div>
  );
}

function DetailCards(props: { stats: StudentDetailStats; range: DateRange }) {
  const { stats, range } = props;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          {studentDisplayName(stats.student)}
        </CardTitle>
        <CardDescription>
          {range.startDate} → {range.endDate}
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="pt-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <Stat label="Sessions" value={stats.totalCount} />
          <Stat
            label="Presence"
            value={stats.presenceNumber}
            suffix={
              stats.presencePercentage !== null
                ? ` (${Math.round(stats.presencePercentage)}%)`
                : undefined
            }
          />
          <Stat
            label="Absences"
            value={stats.absenceNumber}
            suffix={
              stats.absencePercentage !== null
                ? ` (${Math.round(stats.absencePercentage)}%)`
                : undefined
            }
          />
        </dl>
        {stats.categoryItems.length > 0 && (
          <>
            <Separator className="my-3" />
            <div className="flex flex-wrap gap-1">
              {stats.categoryItems.map((item) => (
                <Badge key={item.id} variant="secondary">
                  {item.color && (
                    <span
                      className="mr-1 inline-block size-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                      aria-hidden
                    />
                  )}
                  {item.label}: {Math.round(item.percentage)}%
                </Badge>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat(props: {
  label: string;
  value: number | null;
  suffix?: string;
}) {
  const { label, value, suffix } = props;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">
        {value ?? "–"}
        {suffix ?? ""}
      </dd>
    </div>
  );
}

const PAGE_SIZE = 10;

function RecordsCard(props: { records: AttendanceRecord[] }) {
  const { records } = props;
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [records]);
  const sorted = useMemo(
    () => [...records].sort((a, b) => b.date.localeCompare(a.date)),
    [records],
  );
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Records ({sorted.length})</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 text-xs">Date</TableHead>
              <TableHead className="h-8 text-xs">Status</TableHead>
              <TableHead className="h-8 text-xs">Course</TableHead>
              <TableHead className="h-8 text-xs">Period</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((record, index) => (
              <TableRow
                key={`${record.date}-${record.period?.label ?? "day"}-${index}`}
                title={record.remark ?? undefined}
              >
                <TableCell className="whitespace-nowrap py-1.5 pr-2 text-xs text-muted-foreground">
                  {record.date}
                </TableCell>
                <TableCell className="py-1.5 pr-2 text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    {record.value && (
                      <span
                        className="inline-block size-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: record.value.color || undefined,
                        }}
                        aria-hidden
                      />
                    )}
                    <span className="truncate">{record.value?.label ?? "—"}</span>
                  </span>
                </TableCell>
                <TableCell className="max-w-28 truncate py-1.5 pr-2 text-xs text-muted-foreground">
                  {record.course?.title ?? "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5 text-xs text-muted-foreground">
                  {record.period?.label ?? "—"}
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-4 text-center text-xs text-muted-foreground"
                >
                  No attendance records in this period
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {pageCount > 1 && (
          <div className="mt-2 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <span className="text-xs text-muted-foreground">
              {safePage + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
