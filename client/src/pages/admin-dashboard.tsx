import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { usePageTitle } from "@/hooks/use-page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Users,
  BookOpen,
  FileText,
  FolderOpen,
  RefreshCw,
  ArrowLeft,
  ShieldAlert,
  Download,
  Activity,
} from "lucide-react";

interface AnalyticsData {
  totalEvents: number;
  uniqueSessions: number;
  byAction: { action: string; count: number }[];
  byPage: { page: string; count: number }[];
  byWeek: { week: string; events: number; sessions: number }[];
  byMonth: { month: string; events: number; sessions: number }[];
}

interface ExportHistoryEntry {
  id: number;
  userId: string;
  exportedAt: string;
  rowCounts: { courses: number; content: number; conversions: number; users: number } | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

interface AdminStats {
  totals: {
    courses: number;
    content: number;
    conversions: number;
    users: number;
  };
  monthlyActivity: {
    month: string;
    courses: number;
    content: number;
    conversions: number;
  }[];
  toolPopularity: { toolName: string; count: number }[];
  conversionsByStatus: { status: string; count: number }[];
  conversionsBySource: { sourceType: string; count: number }[];
  recentActivity: {
    id: number;
    toolName: string;
    toolType: string;
    createdAt: string;
    userId: string | null;
  }[];
  userActivity: {
    userId: string | null;
    contentCount: number;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  }[];
}

const PIE_COLORS = ["#8b1a1a", "#333333", "#555555", "#888888", "#aaaaaa", "#cccccc"];

/**
 * SVG pattern fills so multi-series charts are distinguishable without
 * perceiving color (WCAG 1.4.1). Each pattern keeps its series' base color
 * as the background with white texture on top, so grayscale/color-blind
 * users can tell bars apart by texture while the overall palette is unchanged.
 * url(#id) references resolve document-wide, so the Recharts legend icons
 * pick up the same textures automatically.
 */
function ChartPatternDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <pattern id="pattern-diagonal-dark" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#333333" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="1.5" />
        </pattern>
        <pattern id="pattern-dots-gray" patternUnits="userSpaceOnUse" width="6" height="6">
          <rect width="6" height="6" fill="#888888" />
          <circle cx="3" cy="3" r="1.3" fill="#ffffff" />
        </pattern>
        <pattern id="pattern-diagonal-gray" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#555555" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="1.5" />
        </pattern>
      </defs>
    </svg>
  );
}

function formatMonth(ym: string) {
  const [year, month] = ym.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function displayName(row: { email: string | null; firstName: string | null; lastName: string | null; userId: string | null }) {
  if (row.firstName || row.lastName) {
    return [row.firstName, row.lastName].filter(Boolean).join(" ");
  }
  return row.email ?? row.userId ?? "Anonymous";
}

export default function AdminDashboard() {
  usePageTitle("Admin Dashboard — BSU Accessibility Tool");
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const { data: isAdmin, isLoading: checkLoading } = useQuery<boolean>({
    queryKey: ["/api/admin/check"],
    queryFn: async () => {
      const res = await fetch("/api/admin/check", { credentials: "include" });
      return res.status === 200;
    },
    retry: false,
  });

  const { data: stats, isLoading: statsLoading, refetch } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: isAdmin === true,
    retry: false,
  });

  const { data: exportHistory, refetch: refetchHistory } = useQuery<ExportHistoryEntry[]>({
    queryKey: ["/api/admin/export-history"],
    enabled: isAdmin === true,
    retry: false,
  });

  const { data: analyticsData } = useQuery<AnalyticsData>({
    queryKey: ["/api/admin/analytics"],
    enabled: isAdmin === true,
    retry: false,
  });

  if (checkLoading) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground" data-testid="text-admin-loading">Loading…</p>
      </main>
    );
  }

  if (!isAdmin) {
    const notLoggedIn = !authLoading && !isAuthenticated;
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive" data-testid="text-access-denied">
              <ShieldAlert className="w-5 h-5" aria-hidden="true" />
              {notLoggedIn ? "Sign In Required" : "Access Denied"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {notLoggedIn
                ? "Please sign in to access the Admin Dashboard."
                : "You do not have permission to view this page. Admin access is required."}
            </p>
            <div className="flex gap-2 flex-wrap">
              {notLoggedIn && (
                <Button
                  onClick={() => { window.location.href = `/api/login?returnTo=${encodeURIComponent("/admin")}`; }}
                  data-testid="button-sign-in"
                >
                  Sign In
                </Button>
              )}
              <Button variant="outline" onClick={() => navigate("/")} data-testid="button-go-home">
                <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
                Go Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const maxToolCount = stats?.toolPopularity[0]?.count ?? 1;

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <ChartPatternDefs />
      <div className="container mx-auto max-w-6xl px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
              Home
            </Button>
            <h1 className="text-2xl font-bold text-foreground" data-testid="heading-admin-dashboard">
              Admin Dashboard
            </h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { refetch(); refetchHistory(); }}
              data-testid="button-refresh-stats"
            >
              <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const link = document.createElement("a");
                link.href = "/api/admin/stats/export";
                link.download = "";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => refetchHistory(), 1500);
              }}
              data-testid="button-export-csv"
            >
              <Download className="w-4 h-4 mr-2" aria-hidden="true" />
              Export CSV
            </Button>
          </div>
        </div>

        {statsLoading && (
          <p className="text-muted-foreground text-sm" data-testid="text-stats-loading">Loading statistics…</p>
        )}

        {stats && (
          <>
            {/* Summary cards */}
            <section aria-labelledby="section-totals">
              <h2 id="section-totals" className="text-lg font-semibold text-foreground mb-4">Overview</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card data-testid="card-total-courses">
                  <CardContent className="pt-6 flex flex-col items-center gap-2">
                    <BookOpen className="w-6 h-6 text-primary" aria-hidden="true" />
                    <p className="text-3xl font-bold text-foreground" data-testid="text-total-courses">{stats.totals.courses}</p>
                    <p className="text-xs text-muted-foreground">Total Courses</p>
                  </CardContent>
                </Card>
                <Card data-testid="card-total-content">
                  <CardContent className="pt-6 flex flex-col items-center gap-2">
                    <FileText className="w-6 h-6 text-primary" />
                    <p className="text-3xl font-bold text-foreground" data-testid="text-total-content">{stats.totals.content}</p>
                    <p className="text-xs text-muted-foreground">Content Generated</p>
                  </CardContent>
                </Card>
                <Card data-testid="card-total-conversions">
                  <CardContent className="pt-6 flex flex-col items-center gap-2">
                    <FolderOpen className="w-6 h-6 text-primary" />
                    <p className="text-3xl font-bold text-foreground" data-testid="text-total-conversions">{stats.totals.conversions}</p>
                    <p className="text-xs text-muted-foreground">Documents Converted</p>
                  </CardContent>
                </Card>
                <Card data-testid="card-total-users">
                  <CardContent className="pt-6 flex flex-col items-center gap-2">
                    <Users className="w-6 h-6 text-primary" />
                    <p className="text-3xl font-bold text-foreground" data-testid="text-total-users">{stats.totals.users}</p>
                    <p className="text-xs text-muted-foreground">Registered Users</p>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* Monthly activity chart */}
            <section aria-labelledby="section-activity">
              <Card>
                <CardHeader>
                  <CardTitle id="section-activity" className="text-base">Monthly Activity (Last 6 Months)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64" data-testid="chart-monthly-activity">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.monthlyActivity}>
                        <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number, name: string) => [v, name.charAt(0).toUpperCase() + name.slice(1)]} labelFormatter={formatMonth} />
                        <Legend />
                        <Bar dataKey="courses" fill="#8b1a1a" name="Courses" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="content" fill="url(#pattern-diagonal-dark)" name="Content" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="conversions" fill="url(#pattern-dots-gray)" name="Conversions" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </section>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Tool popularity */}
              <section aria-labelledby="section-tools">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle id="section-tools" className="text-base">Tool Popularity</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {stats.toolPopularity.length === 0 && (
                      <p className="text-sm text-muted-foreground">No data yet.</p>
                    )}
                    {stats.toolPopularity.map((tool) => (
                      <div key={tool.toolName} data-testid={`row-tool-${tool.toolName}`}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-foreground truncate max-w-[70%]">{tool.toolName}</span>
                          <span className="text-muted-foreground font-mono">{tool.count}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${Math.round((tool.count / maxToolCount) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>

              {/* Conversion stats */}
              <section aria-labelledby="section-conversions">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle id="section-conversions" className="text-base">Document Conversion Stats</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-40 mb-4" data-testid="chart-conversions-status">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={stats.conversionsByStatus}
                            dataKey="count"
                            nameKey="status"
                            cx="50%"
                            cy="50%"
                            outerRadius={60}
                            label={({ status, percent }) => `${status} ${Math.round((percent ?? 0) * 100)}%`}
                            labelLine={false}
                          >
                            {stats.conversionsByStatus.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-1">
                      {stats.conversionsBySource.map((s) => (
                        <div key={s.sourceType} className="flex justify-between text-sm" data-testid={`row-source-${s.sourceType}`}>
                          <span className="text-foreground capitalize">{s.sourceType}</span>
                          <Badge variant="secondary">{s.count}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </section>
            </div>

            {/* Recent activity */}
            <section aria-labelledby="section-recent">
              <Card>
                <CardHeader>
                  <CardTitle id="section-recent" className="text-base">Recent Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  {stats.recentActivity.length === 0 && (
                    <p className="text-sm text-muted-foreground">No recent activity.</p>
                  )}
                  <ul className="divide-y divide-border" role="list">
                    {stats.recentActivity.map((item) => (
                      <li key={item.id} className="py-2 flex justify-between items-center gap-4" data-testid={`row-activity-${item.id}`}>
                        <div>
                          <span className="text-sm font-medium text-foreground">{item.toolName}</span>
                          <span className="text-xs text-muted-foreground ml-2">{item.toolType}</span>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(item.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>

            {/* User activity table */}
            <section aria-labelledby="section-users">
              <Card>
                <CardHeader>
                  <CardTitle id="section-users" className="text-base">User Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  {stats.userActivity.length === 0 && (
                    <p className="text-sm text-muted-foreground">No user activity yet.</p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" aria-label="User activity">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th scope="col" className="pb-2 font-medium text-muted-foreground">User</th>
                          <th scope="col" className="pb-2 font-medium text-muted-foreground text-right">Content Generated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {stats.userActivity.map((row, idx) => (
                          <tr key={row.userId ?? idx} data-testid={`row-user-${row.userId ?? idx}`}>
                            <td className="py-2 text-foreground">{displayName(row)}</td>
                            <td className="py-2 text-right font-mono text-foreground">{row.contentCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </section>
            {/* Usage Analytics */}
            <section aria-labelledby="section-analytics">
              <Card>
                <CardHeader>
                  <CardTitle id="section-analytics" className="text-base flex items-center gap-2">
                    <Activity className="w-4 h-4" aria-hidden="true" />
                    Usage Analytics
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      (privacy-first — no IPs, emails, or content stored)
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {!analyticsData || analyticsData.totalEvents === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="text-no-analytics">No analytics data recorded yet.</p>
                  ) : (
                    <>
                      {/* Summary cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
                          <p className="text-2xl font-bold text-foreground" data-testid="text-analytics-total-events">{analyticsData.totalEvents.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground mt-1">Total Events</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
                          <p className="text-2xl font-bold text-foreground" data-testid="text-analytics-unique-sessions">{analyticsData.uniqueSessions.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground mt-1">Approx. Unique Sessions</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
                          <p className="text-2xl font-bold text-foreground" data-testid="text-analytics-completed-actions">
                            {analyticsData.byAction.filter(a => a.action !== "page_view").reduce((s, a) => s + a.count, 0).toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">Completed Actions</p>
                        </div>
                      </div>

                      {/* Monthly trend */}
                      {analyticsData.byMonth.length > 0 && (
                        <div>
                          <h3 className="text-sm font-medium text-foreground mb-3">Monthly Sessions &amp; Events</h3>
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={analyticsData.byMonth} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                              <Tooltip />
                              <Legend />
                              <Bar dataKey="sessions" name="Sessions" fill="#8b1a1a" />
                              <Bar dataKey="events" name="Events" fill="url(#pattern-diagonal-gray)" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Weekly trend */}
                      {analyticsData.byWeek.length > 0 && (
                        <div>
                          <h3 className="text-sm font-medium text-foreground mb-3">Weekly Sessions &amp; Events (Last 12 Weeks)</h3>
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={analyticsData.byWeek} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                              <Tooltip />
                              <Legend />
                              <Bar dataKey="sessions" name="Sessions" fill="#8b1a1a" />
                              <Bar dataKey="events" name="Events" fill="url(#pattern-diagonal-gray)" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Page breakdown */}
                      {analyticsData.byPage.length > 0 && (
                        <div>
                          <h3 className="text-sm font-medium text-foreground mb-2">Events by Page</h3>
                          <div className="space-y-1.5">
                            {analyticsData.byPage.map(row => (
                              <div key={row.page} className="flex items-center gap-2 text-sm">
                                <span className="w-32 shrink-0 font-mono text-muted-foreground text-xs truncate">{row.page}</span>
                                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                                  <div
                                    className="bg-primary h-2 rounded-full"
                                    style={{ width: `${Math.round((row.count / analyticsData.byPage[0].count) * 100)}%` }}
                                  />
                                </div>
                                <span className="w-10 text-right font-mono text-muted-foreground text-xs">{row.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action breakdown */}
                      {analyticsData.byAction.length > 0 && (
                        <div>
                          <h3 className="text-sm font-medium text-foreground mb-2">Events by Action</h3>
                          <div className="space-y-1.5">
                            {analyticsData.byAction.map(row => (
                              <div key={row.action} className="flex items-center gap-2 text-sm">
                                <span className="w-40 shrink-0 font-mono text-muted-foreground text-xs truncate">{row.action}</span>
                                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                                  <div
                                    className="bg-primary h-2 rounded-full"
                                    style={{ width: `${Math.round((row.count / analyticsData.byAction[0].count) * 100)}%` }}
                                  />
                                </div>
                                <span className="w-10 text-right font-mono text-muted-foreground text-xs">{row.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Export history */}
            <section aria-labelledby="section-export-history">
              <Card>
                <CardHeader>
                  <CardTitle id="section-export-history" className="text-base">Export History (Last 10)</CardTitle>
                </CardHeader>
                <CardContent>
                  {!exportHistory || exportHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="text-no-export-history">No exports recorded yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" aria-label="Export history">
                        <thead>
                          <tr className="border-b border-border text-left">
                            <th scope="col" className="pb-2 font-medium text-muted-foreground">Exported By</th>
                            <th scope="col" className="pb-2 font-medium text-muted-foreground">Date &amp; Time</th>
                            <th scope="col" className="pb-2 font-medium text-muted-foreground text-right">Courses</th>
                            <th scope="col" className="pb-2 font-medium text-muted-foreground text-right">Content</th>
                            <th scope="col" className="pb-2 font-medium text-muted-foreground text-right">Conversions</th>
                            <th scope="col" className="pb-2 font-medium text-muted-foreground text-right">Users</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {exportHistory.map((entry) => (
                            <tr key={entry.id} data-testid={`row-export-${entry.id}`}>
                              <td className="py-2 text-foreground">
                                {displayName(entry)}
                              </td>
                              <td className="py-2 text-muted-foreground whitespace-nowrap">
                                {new Date(entry.exportedAt).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </td>
                              <td className="py-2 text-right font-mono text-foreground">{entry.rowCounts?.courses ?? "—"}</td>
                              <td className="py-2 text-right font-mono text-foreground">{entry.rowCounts?.content ?? "—"}</td>
                              <td className="py-2 text-right font-mono text-foreground">{entry.rowCounts?.conversions ?? "—"}</td>
                              <td className="py-2 text-right font-mono text-foreground">{entry.rowCounts?.users ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
