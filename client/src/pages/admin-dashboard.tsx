import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  FileCheck,
  Users,
  Activity,
  BarChart3,
  RefreshCw,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  Wrench,
  Mail,
  FileDown,
  RotateCcw,
  Info,
  Settings,
  Shield,
  UserCog,
  Gauge,
} from "lucide-react";
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipProvider as UITooltipProvider,
  TooltipTrigger as UITooltipTrigger,
} from "@/components/ui/tooltip";
import { HeaderControls } from "@/components/header-controls";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface AdminStats {
  summary: {
    totalCourses: number;
    totalContent: number;
    totalConversions: number;
    totalUsers: number;
    activeUsersThisMonth: number;
    totalRefinements: number;
  };
  monthlyTrends: Array<{
    month: string;
    courses: number;
    content: number;
    conversions: number;
  }>;
  toolBreakdown: Array<{
    name: string;
    count: number;
  }>;
  conversionStats: {
    byStatus: Record<string, number>;
    bySourceType: Record<string, number>;
    ocrUsed: number;
  };
  recentCourses: Array<{
    id: number;
    courseName: string;
    courseNumber: string;
    userId: string;
    createdAt: string;
    user: { firstName: string | null; lastName: string | null; email: string | null } | null;
  }>;
  recentContent: Array<{
    id: number;
    toolName: string;
    courseId: number | null;
    userId: string | null;
    createdAt: string;
    user: { firstName: string | null; lastName: string | null; email: string | null } | null;
  }>;
  userActivity: Array<{
    userId: string;
    user: { firstName: string | null; lastName: string | null; email: string | null } | null;
    courseCount: number;
    contentCount: number;
    conversionCount: number;
  }>;
  accessibilityStats: {
    aiChecksRun: number;
    conversionsWithReport: number;
    avgFinalScore: number | null;
    avgOriginalScore: number | null;
    totalIssuesFound: number;
    totalIssuesFixed: number;
    totalIssuesRemaining: number;
  };
  config: {
    versionHistoryLimit: number;
    anonRateLimit: number;
    statsApiKeySet: boolean;
    adminUserCount: number;
  };
}

interface Metrics {
  aiFixRetry: {
    count: number;
    lastAt: string | null;
    lifetimeCount: number;
    thisMonthCount: number;
  };
  thresholds: {
    warnCount: number;
    warnRate: number;
    criticalCount: number;
    criticalRate: number;
  };
}

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#8884d8",
  "#82ca9d",
  "#ffc658",
];

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6"];

function formatSourceType(sourceType: string): string {
  switch (sourceType) {
    case "pdf": return "PDF";
    case "docx": return "Word (DOCX)";
    case "pptx": return "PowerPoint (PPTX)";
    case "google-doc": return "Google Doc";
    case "google-sheet": return "Google Sheet";
    case "google-slide": return "Google Slides";
    default: return sourceType.toUpperCase();
  }
}

function formatMonth(m: string) {
  const [year, month] = m.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month) - 1]} ${year}`;
}

function getUserDisplayName(user: { firstName: string | null; lastName: string | null; email: string | null } | null, userId?: string) {
  if (!user) return userId || "Unknown";
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
  if (user.firstName) return user.firstName;
  if (user.email) return user.email.split("@")[0];
  return userId || "Unknown";
}

export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  usePageTitle("Admin Dashboard");

  const { data: adminCheck, isLoading: isCheckingAdmin } = useQuery<{ isAdmin: boolean }>({
    queryKey: ["/api/admin/check"],
    enabled: isAuthenticated,
  });

  const { data: stats, isLoading: isLoadingStats, refetch, isRefetching, isError, error } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: isAuthenticated && adminCheck?.isAdmin === true,
  });

  const { data: metrics } = useQuery<Metrics>({
    queryKey: ["/api/metrics"],
    enabled: isAuthenticated && adminCheck?.isAdmin === true,
  });

  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<"sent" | "error" | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState(false);

  const handleSendTestEmail = async () => {
    setIsSendingTestEmail(true);
    setTestEmailResult(null);
    try {
      await apiRequest("POST", "/api/admin/send-summary");
      setTestEmailResult("sent");
      setTimeout(() => setTestEmailResult(null), 4000);
    } catch {
      setTestEmailResult("error");
      setTimeout(() => setTestEmailResult(null), 4000);
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  const handleExportCsv = async () => {
    setIsExportingCsv(true);
    try {
      const res = await fetch("/api/admin/stats/export", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bsu-accessibility-export-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsExportingCsv(false);
    }
  };

  if (isAuthLoading || isCheckingAdmin) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  if (!isAuthenticated || !adminCheck?.isAdmin) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md mx-auto">
            <CardContent className="p-8 text-center">
              <ShieldAlert className="w-16 h-16 text-destructive mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
              <p className="text-muted-foreground mb-6">You do not have admin access to view this page.</p>
              <Button onClick={() => navigate("/")} data-testid="button-back-home">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </CardContent>
          </Card>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  if (isError) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md mx-auto">
            <CardContent className="p-8 text-center">
              <ShieldAlert className="w-16 h-16 text-destructive mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">Failed to Load Dashboard</h1>
              <p className="text-muted-foreground mb-6">{error?.message || "An error occurred while loading stats."}</p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={() => navigate("/")} data-testid="button-error-back">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Home
                </Button>
                <Button onClick={() => refetch()} data-testid="button-error-retry">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  if (isLoadingStats || !stats) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading dashboard data...</p>
          </div>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  const conversionStatusData = Object.entries(stats.conversionStats.byStatus).map(([status, count]) => ({
    name: status.charAt(0).toUpperCase() + status.slice(1),
    value: count,
  }));

  const conversionSourceData = Object.entries(stats.conversionStats.bySourceType ?? {})
    .map(([sourceType, count]) => ({ name: formatSourceType(sourceType), value: count }))
    .sort((a, b) => b.value - a.value);

  const trendData = stats.monthlyTrends.map(t => ({
    ...t,
    month: formatMonth(t.month),
  }));

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <div className="absolute top-4 right-4 z-20">
        <HeaderControls showLogout={true} />
      </div>

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-admin-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-foreground" data-testid="text-admin-title">Admin Dashboard</h1>
              <p className="text-muted-foreground">Usage statistics and activity overview</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={isExportingCsv}
              data-testid="button-export-csv"
            >
              <FileDown className={`w-4 h-4 mr-2 ${isExportingCsv ? "animate-pulse" : ""}`} />
              {isExportingCsv ? "Exporting…" : "Export CSV"}
            </Button>
            <Button
              variant="outline"
              onClick={handleSendTestEmail}
              disabled={isSendingTestEmail}
              data-testid="button-send-test-email"
            >
              <Mail className="w-4 h-4 mr-2" />
              {isSendingTestEmail
                ? "Sending…"
                : testEmailResult === "sent"
                ? "✓ Email Sent"
                : testEmailResult === "error"
                ? "Failed — Retry?"
                : "Send Test Email"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
                refetch();
              }}
              disabled={isRefetching}
              data-testid="button-refresh-stats"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card data-testid="card-total-courses">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Courses</p>
                  <p className="text-3xl font-bold text-foreground">{stats.summary.totalCourses}</p>
                </div>
                <BookOpen className="w-10 h-10 text-primary/30" />
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-total-content">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Content Generated</p>
                  <p className="text-3xl font-bold text-foreground">{stats.summary.totalContent}</p>
                </div>
                <FileText className="w-10 h-10 text-primary/30" />
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-total-conversions">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Documents Converted</p>
                  <p className="text-3xl font-bold text-foreground">{stats.summary.totalConversions}</p>
                </div>
                <FileCheck className="w-10 h-10 text-primary/30" />
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-active-users">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Users This Month</p>
                  <p className="text-3xl font-bold text-foreground">{stats.summary.activeUsersThisMonth}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stats.summary.totalUsers} total registered</p>
                </div>
                <Users className="w-10 h-10 text-primary/30" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 mb-8">
          <Card data-testid="card-monthly-trends">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Monthly Activity Trends
              </CardTitle>
              <CardDescription>Activity over the past 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        color: "hsl(var(--foreground))",
                      }}
                    />
                    <Legend />
                    <Bar dataKey="courses" name="Courses" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="content" name="Content" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="conversions" name="Conversions" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-tool-breakdown">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Tool Popularity
              </CardTitle>
              <CardDescription>Most used content generation tools</CardDescription>
            </CardHeader>
            <CardContent>
              {stats.toolBreakdown.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No content generated yet</p>
              ) : (
                <div className="space-y-3">
                  {stats.toolBreakdown.map((tool, i) => {
                    const maxCount = stats.toolBreakdown[0]?.count || 1;
                    const pct = (tool.count / maxCount) * 100;
                    return (
                      <div key={tool.name} data-testid={`tool-bar-${i}`}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm font-medium text-foreground">{tool.name}</span>
                          <span className="text-sm text-muted-foreground">{tool.count}</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2.5">
                          <div
                            className="h-2.5 rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 mb-8">
          <Card data-testid="card-conversion-stats">
            <CardHeader>
              <CardTitle>Document Conversion Stats</CardTitle>
              <CardDescription>Conversion outcomes and OCR usage</CardDescription>
            </CardHeader>
            <CardContent>
              {conversionStatusData.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No conversions yet</p>
              ) : (
                <div className="flex items-center gap-8">
                  <div className="h-[200px] w-[200px] flex-shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={conversionStatusData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {conversionStatusData.map((_entry, index) => (
                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            color: "hsl(var(--foreground))",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2 flex-1">
                    {conversionStatusData.map((entry, i) => (
                      <div key={entry.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-sm text-foreground">{entry.name}</span>
                        <span className="text-sm text-muted-foreground ml-auto">{entry.value}</span>
                      </div>
                    ))}
                    <div className="pt-2 border-t mt-2">
                      <p className="text-sm text-muted-foreground">OCR applied: <span className="font-medium text-foreground">{stats.conversionStats.ocrUsed}</span></p>
                    </div>
                    {conversionSourceData.length > 0 && (
                      <div className="pt-2 border-t mt-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">By Source</p>
                        {conversionSourceData.map((entry) => (
                          <div key={entry.name} className="flex items-center gap-2 mb-1">
                            <span className="text-sm text-foreground">{entry.name}</span>
                            <span className="text-sm text-muted-foreground ml-auto">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-recent-activity">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest courses and content created</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {[
                  ...stats.recentCourses.map(c => ({
                    type: "course" as const,
                    label: `${c.courseName} (${c.courseNumber})`,
                    user: getUserDisplayName(c.user, c.userId),
                    date: c.createdAt,
                  })),
                  ...stats.recentContent.map(c => ({
                    type: "content" as const,
                    label: c.toolName,
                    user: getUserDisplayName(c.user, c.userId || undefined),
                    date: c.createdAt,
                  })),
                ]
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .slice(0, 15)
                  .map((item, i) => (
                    <div key={`${item.type}-${i}`} className="flex items-start gap-3 py-2 border-b last:border-0" data-testid={`activity-item-${i}`}>
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${item.type === "course" ? "bg-indigo-500" : "bg-emerald-500"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{item.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.user} &middot; {format(new Date(item.date), "MMM d, yyyy h:mm a")}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                        item.type === "course"
                          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      }`}>
                        {item.type === "course" ? "Course" : "Content"}
                      </span>
                    </div>
                  ))}
                {stats.recentCourses.length === 0 && stats.recentContent.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">No activity yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-8" data-testid="card-accessibility-stats">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              Accessibility Insights
            </CardTitle>
            <CardDescription>Usage and outcomes across all accessibility tools</CardDescription>
          </CardHeader>
          <CardContent>
            {!stats.accessibilityStats || (stats.accessibilityStats.aiChecksRun === 0 && stats.accessibilityStats.conversionsWithReport === 0) ? (
              <p className="text-muted-foreground text-center py-8">No accessibility tool usage yet</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-start gap-3" data-testid="stat-ai-checks">
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{stats.accessibilityStats.aiChecksRun}</p>
                    <p className="text-sm text-muted-foreground">AI Accessibility Checks</p>
                  </div>
                </div>

                <div className="flex items-start gap-3" data-testid="stat-conversions-with-report">
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{stats.accessibilityStats.conversionsWithReport}</p>
                    <p className="text-sm text-muted-foreground">Documents with Compliance Report</p>
                  </div>
                </div>

                <div className="flex items-start gap-3" data-testid="stat-avg-score">
                  <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-950 flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    {stats.accessibilityStats.avgFinalScore !== null ? (
                      <>
                        <div className="flex items-baseline gap-2">
                          <p className="text-2xl font-bold text-foreground">{stats.accessibilityStats.avgFinalScore}%</p>
                          {stats.accessibilityStats.avgOriginalScore !== null && stats.accessibilityStats.avgOriginalScore !== stats.accessibilityStats.avgFinalScore && (() => {
                            const delta = stats.accessibilityStats.avgFinalScore! - stats.accessibilityStats.avgOriginalScore!;
                            const isPositive = delta > 0;
                            return (
                              <span className={`text-sm font-medium ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                {isPositive ? `+${delta}% improved` : `${delta}% declined`}
                              </span>
                            );
                          })()}
                        </div>
                        <p className="text-sm text-muted-foreground">Avg. Compliance Score</p>
                        {stats.accessibilityStats.avgOriginalScore !== null && (
                          <p className="text-xs text-muted-foreground mt-0.5">Before fixes: {stats.accessibilityStats.avgOriginalScore}%</p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-2xl font-bold text-muted-foreground">—</p>
                        <p className="text-sm text-muted-foreground">Avg. Compliance Score</p>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3" data-testid="stat-issues-found">
                  <div className="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-950 flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{stats.accessibilityStats.totalIssuesFound}</p>
                    <p className="text-sm text-muted-foreground">Total WCAG Issues Found</p>
                  </div>
                </div>

                <div className="flex items-start gap-3" data-testid="stat-issues-fixed">
                  <div className="w-9 h-9 rounded-lg bg-teal-100 dark:bg-teal-950 flex items-center justify-center flex-shrink-0">
                    <Wrench className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{stats.accessibilityStats.totalIssuesFixed}</p>
                    <p className="text-sm text-muted-foreground">Issues Auto-Fixed</p>
                  </div>
                </div>

                <div className="flex items-start gap-3" data-testid="stat-issues-remaining">
                  <div className="w-9 h-9 rounded-lg bg-orange-100 dark:bg-orange-950 flex items-center justify-center flex-shrink-0">
                    <FileCheck className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">
                      {stats.accessibilityStats.totalIssuesRemaining}
                    </p>
                    <p className="text-sm text-muted-foreground">Issues Remaining</p>
                    {stats.accessibilityStats.totalIssuesFound > 0 && (
                      <div className="mt-1.5 w-full bg-muted rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-teal-500 transition-all"
                          style={{
                            width: `${Math.min(100, (stats.accessibilityStats.totalIssuesFixed / stats.accessibilityStats.totalIssuesFound) * 100)}%`
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {(() => {
          const retryCount = metrics?.aiFixRetry.count ?? 0;
          const aiChecksRun = stats.accessibilityStats?.aiChecksRun ?? 0;
          const retryRate = aiChecksRun > 0 ? retryCount / aiChecksRun : 0;

          const warnCount    = metrics?.thresholds?.warnCount    ?? 10;
          const warnRate     = metrics?.thresholds?.warnRate     ?? 0.05;
          const criticalCount = metrics?.thresholds?.criticalCount ?? 25;
          const criticalRate  = metrics?.thresholds?.criticalRate  ?? 0.10;

          const isCritical = retryCount > criticalCount || (aiChecksRun > 0 && retryRate > criticalRate);
          const isWarning = !isCritical && (retryCount > warnCount || (aiChecksRun > 0 && retryRate > warnRate));

          const cardBorderClass = isCritical
            ? "border-red-400 dark:border-red-600"
            : isWarning
            ? "border-amber-400 dark:border-amber-600"
            : "";

          const retryRatePct = aiChecksRun > 0
            ? `${(retryRate * 100).toFixed(1)}% of AI checks`
            : null;

          return (
            <Card className={`mb-8 ${cardBorderClass}`} data-testid="card-ai-retry-metrics">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RotateCcw className={`w-5 h-5 ${isCritical ? "text-red-500" : isWarning ? "text-amber-500" : ""}`} />
                  AI Fix Retries
                  {isCritical && (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-950 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300" data-testid="badge-retry-critical">
                      High
                    </span>
                  )}
                  {isWarning && (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300" data-testid="badge-retry-warning">
                      Elevated
                    </span>
                  )}
                  <UITooltipProvider>
                    <UITooltip>
                      <UITooltipTrigger asChild>
                        <button
                          className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                          aria-label="About retry thresholds"
                          data-testid="button-retry-threshold-info"
                        >
                          <Info className="w-4 h-4" />
                        </button>
                      </UITooltipTrigger>
                      <UITooltipContent side="left" className="max-w-xs text-sm">
                        <p className="font-medium mb-1">Retry rate thresholds</p>
                        <p className="text-muted-foreground">
                          <span className="text-amber-600 dark:text-amber-400 font-medium">Elevated</span> — more than {warnCount} retries or more than {(warnRate * 100).toFixed(0)}% of AI checks needed a second attempt.
                        </p>
                        <p className="text-muted-foreground mt-1">
                          <span className="text-red-600 dark:text-red-400 font-medium">High</span> — more than {criticalCount} retries or more than {(criticalRate * 100).toFixed(0)}% of AI checks needed a second attempt.
                        </p>
                        <p className="text-muted-foreground mt-1">Thresholds apply to the since-restart count. Lifetime and monthly counts persist across restarts. Thresholds can be adjusted via the <code className="font-mono text-xs">RETRY_WARN_COUNT</code>, <code className="font-mono text-xs">RETRY_WARN_RATE</code>, <code className="font-mono text-xs">RETRY_CRITICAL_COUNT</code>, and <code className="font-mono text-xs">RETRY_CRITICAL_RATE</code> environment variables.</p>
                      </UITooltipContent>
                    </UITooltip>
                  </UITooltipProvider>
                </CardTitle>
                <CardDescription>
                  Times the AI needed a second attempt to fix an accessibility issue. Lifetime and monthly counts are stored in the database.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(isCritical || isWarning) && (
                  <div
                    className={`flex items-start gap-2 rounded-lg border px-4 py-3 mb-4 text-sm ${
                      isCritical
                        ? "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300"
                        : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    }`}
                    role="alert"
                    data-testid="alert-retry-threshold"
                  >
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>
                      {isCritical
                        ? `The retry count is unusually high (${retryCount}${retryRatePct ? ` — ${retryRatePct}` : ""}). This may indicate a recurring issue with AI-generated fixes that warrants investigation.`
                        : `The retry count is above the normal threshold (${retryCount}${retryRatePct ? ` — ${retryRatePct}` : ""}). Keep an eye on this if it continues to climb.`}
                    </span>
                  </div>
                )}
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex items-start gap-3" data-testid="stat-ai-retry-lifetime">
                    <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-950 flex items-center justify-center flex-shrink-0">
                      <RotateCcw className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {metrics?.aiFixRetry.lifetimeCount ?? "—"}
                      </p>
                      <p className="text-sm text-muted-foreground">Lifetime retries</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3" data-testid="stat-ai-retry-month">
                    <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-950 flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {metrics?.aiFixRetry.thisMonthCount ?? "—"}
                      </p>
                      <p className="text-sm text-muted-foreground">This month</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3" data-testid="stat-ai-retry-count">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      isCritical
                        ? "bg-red-100 dark:bg-red-950"
                        : isWarning
                        ? "bg-amber-100 dark:bg-amber-950"
                        : "bg-amber-100 dark:bg-amber-950"
                    }`}>
                      <RotateCcw className={`w-4 h-4 ${
                        isCritical
                          ? "text-red-600 dark:text-red-400"
                          : isWarning
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`} />
                    </div>
                    <div>
                      <p className={`text-2xl font-bold ${
                        isCritical
                          ? "text-red-600 dark:text-red-400"
                          : isWarning
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-foreground"
                      }`}>
                        {retryCount}
                      </p>
                      <p className="text-sm text-muted-foreground">Since last restart</p>
                      {retryRatePct && (
                        <p className="text-xs text-muted-foreground mt-0.5">{retryRatePct}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3" data-testid="stat-ai-retry-last">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
                      <Activity className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {metrics?.aiFixRetry.lastAt
                          ? format(new Date(metrics.aiFixRetry.lastAt), "MMM d, h:mm a")
                          : "—"}
                      </p>
                      <p className="text-sm text-muted-foreground">Most recent retry</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <Card className="mb-8" data-testid="card-system-config">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              System Configuration
            </CardTitle>
            <CardDescription>
              Active server configuration values — change these via environment variables
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="flex items-start gap-3" data-testid="stat-version-history-limit">
                <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-sky-950 flex items-center justify-center flex-shrink-0">
                  <RotateCcw className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-foreground">{stats.config.versionHistoryLimit}</p>
                    {stats.config.versionHistoryLimit > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-950 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300" data-testid="badge-version-pruning">
                        Pruning On
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300" data-testid="badge-version-pruning">
                        No Pruning
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">Version History Limit</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Max versions per content item (<code className="font-mono bg-muted px-1 rounded">VERSION_HISTORY_LIMIT</code>)
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3" data-testid="stat-anon-rate-limit">
                <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-950 flex items-center justify-center flex-shrink-0">
                  <Gauge className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-foreground">{stats.config.anonRateLimit}</p>
                    {stats.config.anonRateLimit > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-950 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300" data-testid="badge-anon-rate-limit">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300" data-testid="badge-anon-rate-limit">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">Anonymous Rate Limit</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Max AI requests per anonymous session (<code className="font-mono bg-muted px-1 rounded">ANON_RATE_LIMIT</code>)
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3" data-testid="stat-stats-api-key">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${stats.config.statsApiKeySet ? "bg-green-100 dark:bg-green-950" : "bg-muted"}`}>
                  <Shield className={`w-4 h-4 ${stats.config.statsApiKeySet ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-foreground">{stats.config.statsApiKeySet ? "Set" : "Not set"}</p>
                    {stats.config.statsApiKeySet ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-950 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300" data-testid="badge-stats-api-key">
                        Protected
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300" data-testid="badge-stats-api-key">
                        Open
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">Stats API Key</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Whether the public stats endpoint requires an API key (<code className="font-mono bg-muted px-1 rounded">STATS_API_KEY</code>)
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3" data-testid="stat-admin-user-count">
                <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-950 flex items-center justify-center flex-shrink-0">
                  <UserCog className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-foreground">{stats.config.adminUserCount}</p>
                    {stats.config.adminUserCount > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-950 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300" data-testid="badge-admin-user-count">
                        Configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300" data-testid="badge-admin-user-count">
                        No Admins
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">Configured Admins</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Number of user IDs with admin access (<code className="font-mono bg-muted px-1 rounded">ADMIN_USER_IDS</code>)
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-8" data-testid="card-user-activity">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              User Activity
            </CardTitle>
            <CardDescription>Top users by engagement ({stats.summary.totalRefinements} total content refinements)</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.userActivity.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No user activity yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">User</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Courses</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Content</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Conversions</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.userActivity.map((u, i) => (
                      <tr key={u.userId} className="border-b last:border-0 hover:bg-muted/50 transition-colors" data-testid={`user-row-${i}`}>
                        <td className="py-3 px-4">
                          <p className="font-medium text-foreground">{getUserDisplayName(u.user, u.userId)}</p>
                          {u.user?.email && <p className="text-xs text-muted-foreground">{u.user.email}</p>}
                        </td>
                        <td className="text-right py-3 px-4 text-foreground">{u.courseCount}</td>
                        <td className="text-right py-3 px-4 text-foreground">{u.contentCount}</td>
                        <td className="text-right py-3 px-4 text-foreground">{u.conversionCount}</td>
                        <td className="text-right py-3 px-4 font-medium text-foreground">{u.courseCount + u.contentCount + u.conversionCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <PoweredByFooter />
    </main>
  );
}
