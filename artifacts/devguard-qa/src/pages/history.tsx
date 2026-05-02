import { useGetReviewHistory, getGetReviewHistoryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Shield, Zap, Code, AlertCircle, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function History() {
  const { data: history, isLoading, error } = useGetReviewHistory({
    query: { queryKey: getGetReviewHistoryQueryKey() }
  });

  return (
    <div className="flex-1 p-6 md:p-10 flex flex-col bg-background/50 overflow-hidden">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Audit History</h1>
        <p className="text-muted-foreground mt-2">Past security reviews and their findings.</p>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden border-border/50 shadow-sm bg-card/50 backdrop-blur">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <AlertCircle className="h-10 w-10 text-destructive mb-4" />
            <p>Failed to load history.</p>
          </div>
        ) : history?.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <Shield className="h-12 w-12 text-muted mb-4" />
            <p className="text-lg font-medium text-foreground">No history yet</p>
            <p className="text-sm">Run an analysis to see history here.</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 backdrop-blur z-10">
                <TableRow className="border-border">
                  <TableHead className="w-[100px]">Date</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Code Snippet</TableHead>
                  <TableHead className="text-right">Issues</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history?.map((review) => (
                  <TableRow key={review.reviewId} className="border-border hover:bg-muted/30 cursor-pointer group transition-colors">
                    <TableCell className="font-medium text-xs whitespace-nowrap text-muted-foreground">
                      {format(new Date(review.createdAt), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-[10px] font-mono">
                        {review.language}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <code className="text-xs text-muted-foreground truncate block font-mono">
                        {review.codeSnippet.replace(/\n/g, ' ')}...
                      </code>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2 text-xs font-medium">
                        <span className="flex items-center gap-1 text-destructive" title="Critical Security">
                          <Shield size={12} /> {review.criticalCount}
                        </span>
                        <span className="flex items-center gap-1 text-yellow-500" title="Performance">
                          <Zap size={12} /> {review.performanceCount}
                        </span>
                        <span className="flex items-center gap-1 text-blue-500" title="Style">
                          <Code size={12} /> {review.styleCount}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge className={`
                        ${review.score >= 90 ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20' : 
                          review.score >= 70 ? 'bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20' : 
                          'bg-destructive/10 text-destructive hover:bg-destructive/20'}
                        border-0 shadow-none
                      `}>
                        {review.score}/100
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </Card>
    </div>
  );
}
