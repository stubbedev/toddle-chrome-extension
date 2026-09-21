import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
  fetchStudentDetailStats,
  fetchStudentRecords,
  studentDisplayName,
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
  academicYearIds: string[] | null;
  onBack: () => void;
}

export function StudentDetail({ auth, studentId, range, academicYearIds, onBack }: Props) {
  const [stats, setStats] = useState<StudentDetailStats | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setStats(null);
    setRecords(null);
    Promise.all([
      fetchStudentDetailStats(auth.token, studentId, range, academicYearIds),
      fetchStudentRecords(auth.token, studentId, range, academicYearIds),
    ])
      .then(([s, r]) => {
        if (cancelled) return;
        setStats(s);
        setRecords(r);
      })
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [auth.token, studentId, range, academicYearIds]);

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

function RecordsCard(props: { records: AttendanceRecord[] }) {
  const { records } = props;
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Records ({sorted.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {sorted.slice(0, 40).map((record, index) => (
          <div
            key={`${record.date}-${record.period?.label ?? "day"}-${index}`}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="text-muted-foreground">{record.date}</span>
            <span className="flex items-center gap-1 truncate">
              {record.value && (
                <span
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: record.value.color || undefined }}
                  aria-hidden
                />
              )}
              <span className="truncate">
                {record.value?.label ?? "—"}
                {record.course && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {record.course.title}
                  </span>
                )}
                {record.period && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {record.period.label}
                  </span>
                )}
              </span>
            </span>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No attendance records in this period
          </p>
        )}
        {sorted.length > 40 && (
          <p className="text-[10px] text-muted-foreground">
            Showing latest 40 of {sorted.length}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
