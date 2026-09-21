import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getToddleAuth, TODDLE_LOGIN_URL, type ToddleAuth } from "@/lib/auth";
import type { DateRange } from "@/lib/attendance";
import {
  AttendanceOverview,
  RefreshButton,
} from "@/sidepanel/AttendanceOverview";
import { StudentDetail } from "@/sidepanel/StudentDetail";

type AuthState =
  | { status: "checking" }
  | { status: "logged-out" }
  | { status: "logged-in"; auth: ToddleAuth };

type View =
  | { name: "overview" }
  | { name: "student"; studentId: string; range: DateRange; academicYearIds: string[] | null };

export function App() {
  const [state, setState] = useState<AuthState>({ status: "checking" });
  const [view, setView] = useState<View>({ name: "overview" });

  const refresh = async () => {
    setState({ status: "checking" });
    const auth = await getToddleAuth();
    setState(auth ? { status: "logged-in", auth } : { status: "logged-out" });
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="min-h-screen bg-background p-3 text-foreground">
      <header className="mb-3 flex items-center justify-between">
        <h1 className="text-sm font-semibold">Toddle Companion</h1>
        <RefreshButton onClick={() => void refresh()} />
      </header>

      {state.status === "checking" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Checking login…</CardTitle>
          </CardHeader>
        </Card>
      )}

      {state.status === "logged-out" && <LoginGate />}

      {state.status === "logged-in" &&
        (view.name === "overview" ? (
          <AttendanceOverview
            auth={state.auth}
            onSelectStudent={(studentId, range, academicYearIds) =>
              setView({ name: "student", studentId, range, academicYearIds })
            }
          />
        ) : (
          <StudentDetail
            auth={state.auth}
            studentId={view.studentId}
            range={view.range}
            academicYearIds={view.academicYearIds}
            onBack={() => setView({ name: "overview" })}
          />
        ))}
    </div>
  );
}

function LoginGate() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Not signed in to toddle</CardTitle>
        <CardDescription>
          This extension uses your logged-in toddle session. Open toddle, sign
          in, then hit refresh.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => chrome.tabs.create({ url: TODDLE_LOGIN_URL })}>
          <LogIn className="size-4" /> Log in to toddle
        </Button>
      </CardContent>
    </Card>
  );
}
