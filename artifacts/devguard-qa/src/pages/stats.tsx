import { useGetReviewStats, getGetReviewStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Zap, Code, Target, AlertTriangle, TrendingUp, Search, Loader2 } from "lucide-react";

export default function Stats() {
  const { data: stats, isLoading, error } = useGetReviewStats({
    query: { queryKey: getGetReviewStatsQueryKey() }
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
        <p>Failed to load statistics.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 md:p-10 bg-background/50 overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Metrics Dashboard</h1>
        <p className="text-muted-foreground mt-2">Aggregate analytics across all code reviews.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <Card className="border-border/50 bg-card/50 backdrop-blur shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Scans</span>
              <div className="w-8 h-8 rounded bg-primary/10 text-primary flex items-center justify-center">
                <Search size={16} />
              </div>
            </div>
            <div className="text-4xl font-bold">{stats.totalReviews}</div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Issues</span>
              <div className="w-8 h-8 rounded bg-destructive/10 text-destructive flex items-center justify-center">
                <Target size={16} />
              </div>
            </div>
            <div className="text-4xl font-bold">{stats.totalFindings}</div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Avg Score</span>
              <div className="w-8 h-8 rounded bg-green-500/10 text-green-500 flex items-center justify-center">
                <TrendingUp size={16} />
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div className="text-4xl font-bold">{stats.averageScore.toFixed(1)}</div>
              <span className="text-muted-foreground mb-1">/ 100</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-border/50 bg-card/50 backdrop-blur shadow-sm border-t-4 border-t-destructive">
            <CardContent className="p-6 flex flex-col items-center text-center">
              <Shield size={32} className="text-destructive mb-3" />
              <div className="text-3xl font-bold mb-1">{stats.criticalTotal}</div>
              <span className="text-sm text-muted-foreground">Critical Vulnerabilities</span>
            </CardContent>
          </Card>
          
          <Card className="border-border/50 bg-card/50 backdrop-blur shadow-sm border-t-4 border-t-yellow-500">
            <CardContent className="p-6 flex flex-col items-center text-center">
              <Zap size={32} className="text-yellow-500 mb-3" />
              <div className="text-3xl font-bold mb-1">{stats.performanceTotal}</div>
              <span className="text-sm text-muted-foreground">Performance Bottlenecks</span>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50 backdrop-blur shadow-sm border-t-4 border-t-blue-500">
            <CardContent className="p-6 flex flex-col items-center text-center">
              <Code size={32} className="text-blue-500 mb-3" />
              <div className="text-3xl font-bold mb-1">{stats.styleTotal}</div>
              <span className="text-sm text-muted-foreground">Style Violations</span>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/50 bg-card/50 backdrop-blur shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Most Common Issue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-4 flex items-start gap-3 border border-border/50">
              <AlertTriangle className="text-yellow-500 shrink-0 mt-0.5" size={18} />
              <div>
                <p className="font-medium text-sm leading-tight text-foreground/90">{stats.mostCommonIssue}</p>
                <p className="text-xs text-muted-foreground mt-2">Appears most frequently across all scanned repositories.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
