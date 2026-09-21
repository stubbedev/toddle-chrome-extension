import { useEffect, useState } from "react";
import { LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getToddleAuth, TODDLE_LOGIN_URL, type ToddleAuth } from "@/lib/auth";
import { apiEndpointForRegion } from "@/lib/api";

type AuthState =
  | { status: "checking" }
  | { status: "logged-out" }
  | { status: "logged-in"; auth: ToddleAuth };

export function App() {
  const [state, setState] = useState<AuthState>({ status: "checking" });

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
        <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh">
          <RefreshCw className="size-4" />
        </Button>
      </header>

      {state.status === "checking" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Checking login…</CardTitle>
          </CardHeader>
        </Card>
      )}

      {state.status === "logged-out" && <LoginGate />}

      {state.status === "logged-in" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              {state.auth.name ?? "Signed in"}
                {state.auth.orgRegion && (
                  <Badge variant="outline">{state.auth.orgRegion}</Badge>
                )}
                <Badge variant="secondary">via {state.auth.source}</Badge>
              </CardTitle>
            <CardDescription>
              {[state.auth.email, state.auth.userId].filter(Boolean).join(" · ")}
              {state.auth.expiresAt
                ? ` · token valid until ${new Date(state.auth.expiresAt * 1000).toLocaleString()}`
                : ""}
            </CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-1 pt-3 text-xs text-muted-foreground">
            <p>{state.auth.detail}</p>
            <p>API: {apiEndpointForRegion(state.auth.orgRegion)}</p>
            <p className="mt-2">
              Attendance tools will land here. The queries live in
              <code className="mx-1 rounded bg-muted px-1 py-0.5">graphql/operations/</code>
              in the repo.
            </p>
          </CardContent>
        </Card>
      )}
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
