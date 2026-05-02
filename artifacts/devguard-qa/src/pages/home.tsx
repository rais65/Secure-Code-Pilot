import { useState } from "react";
import { useAnalyzeCode, useAutofixCode } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Shield, Zap, Code, AlertTriangle, CheckCircle2, Play, GitBranch, Copy, Loader2, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

export default function Home() {
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("typescript");
  const [githubUrl, setGithubUrl] = useState("");
  const { toast } = useToast();

  const analyzeCodeMutation = useAnalyzeCode();
  const autofixCodeMutation = useAutofixCode();

  const result = analyzeCodeMutation.data;
  const isAnalyzing = analyzeCodeMutation.isPending;

  const [fixedCode, setFixedCode] = useState<string | null>(null);
  const [isFixing, setIsFixing] = useState(false);

  const handleAnalyze = () => {
    if (!code.trim() && !githubUrl.trim()) {
      toast({
        title: "Input required",
        description: "Please provide code or a GitHub URL to analyze.",
        variant: "destructive"
      });
      return;
    }

    setFixedCode(null);
    analyzeCodeMutation.mutate({
      data: {
        code,
        language,
        githubUrl: githubUrl || undefined
      }
    });
  };

  const handleAutofix = () => {
    if (!result || !result.findings.length) return;
    
    setIsFixing(true);
    autofixCodeMutation.mutate({
      data: {
        code,
        language,
        findings: result.findings
      }
    }, {
      onSuccess: (data) => {
        setFixedCode(data.fixedCode);
        toast({
          title: "Auto-fix complete",
          description: `Fixed ${data.issuesFixed} issues.`,
        });
      },
      onSettled: () => setIsFixing(false)
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "Code has been copied to your clipboard.",
    });
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
      {/* LEFT PANEL */}
      <div className="w-full md:w-1/2 flex flex-col border-b md:border-b-0 md:border-r border-border bg-card/30">
        <div className="p-4 border-b border-border flex flex-col gap-4 shrink-0 bg-background/50 backdrop-blur z-10">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Code size={18} className="text-primary" />
              Target Source
            </h2>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-[140px] h-8 text-xs bg-card">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="typescript">TypeScript</SelectItem>
                <SelectItem value="javascript">JavaScript</SelectItem>
                <SelectItem value="python">Python</SelectItem>
                <SelectItem value="go">Go</SelectItem>
                <SelectItem value="rust">Rust</SelectItem>
                <SelectItem value="java">Java</SelectItem>
                <SelectItem value="csharp">Java</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex gap-2">
            <div className="relative flex-1">
              <GitBranch className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Or paste GitHub URL..." 
                className="pl-9 h-9 text-sm bg-card font-mono"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
              />
            </div>
            <Button 
              size="sm" 
              className="gap-2 h-9 px-4 shadow-primary/20 shadow-lg"
              onClick={handleAnalyze}
              disabled={isAnalyzing || isFixing}
            >
              {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              Analyze
            </Button>
          </div>
        </div>

        <div className="flex-1 p-0 relative">
          <Textarea 
            placeholder="Paste your code here for analysis..."
            className="w-full h-full min-h-[300px] md:min-h-full resize-none border-0 focus-visible:ring-0 rounded-none font-mono text-sm p-4 bg-transparent leading-relaxed text-muted-foreground focus:text-foreground transition-colors placeholder:text-muted/50"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
          />
          {isAnalyzing && (
            <div className="absolute inset-0 pointer-events-none bg-primary/5">
              <div className="w-full h-1 bg-primary/40 shadow-[0_0_15px_rgba(var(--primary),0.5)] animate-[scan_2s_ease-in-out_infinite]" />
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="w-full md:w-1/2 flex flex-col bg-background relative">
        {isAnalyzing ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <div className="relative w-24 h-24 mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
              <Shield className="absolute inset-0 m-auto text-primary animate-pulse" size={32} />
            </div>
            <h3 className="text-xl font-medium text-foreground mb-2">Analyzing Codebase</h3>
            <p className="max-w-xs">Running security heuristics, performance checks, and style validations...</p>
          </div>
        ) : result ? (
          <ScrollArea className="flex-1">
            <div className="p-6 space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight mb-1">Analysis Complete</h2>
                  <p className="text-muted-foreground">{result.summary}</p>
                </div>
                <div className="flex flex-col items-center justify-center bg-card border border-border rounded-xl p-3 shadow-sm min-w-[80px]">
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Score</span>
                  <span className={`text-3xl font-bold ${result.score >= 90 ? 'text-green-500' : result.score >= 70 ? 'text-yellow-500' : 'text-destructive'}`}>
                    {result.score}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-card border border-border rounded-lg p-3 flex flex-col items-center justify-center gap-1 text-center">
                  <Shield size={20} className="text-destructive mb-1" />
                  <span className="text-2xl font-bold">{result.criticalCount}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Security</span>
                </div>
                <div className="bg-card border border-border rounded-lg p-3 flex flex-col items-center justify-center gap-1 text-center">
                  <Zap size={20} className="text-yellow-500 mb-1" />
                  <span className="text-2xl font-bold">{result.performanceCount}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Performance</span>
                </div>
                <div className="bg-card border border-border rounded-lg p-3 flex flex-col items-center justify-center gap-1 text-center">
                  <Code size={20} className="text-blue-500 mb-1" />
                  <span className="text-2xl font-bold">{result.styleCount}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Style</span>
                </div>
              </div>

              {result.findings.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Findings</h3>
                    <Button 
                      size="sm" 
                      variant="secondary" 
                      className="gap-2"
                      onClick={handleAutofix}
                      disabled={isFixing}
                    >
                      {isFixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4 text-yellow-500" />}
                      Auto-Fix Issues
                    </Button>
                  </div>
                  
                  <div className="space-y-3">
                    {result.findings.map((finding) => (
                      <Card key={finding.id} className="overflow-hidden border-l-4" style={{ 
                        borderLeftColor: finding.category === 'critical_security' ? 'hsl(var(--destructive))' : 
                                         finding.category === 'performance' ? '#eab308' : '#3b82f6' 
                      }}>
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <div className="flex items-center gap-2">
                              {finding.category === 'critical_security' && <Shield size={16} className="text-destructive shrink-0" />}
                              {finding.category === 'performance' && <Zap size={16} className="text-yellow-500 shrink-0" />}
                              {finding.category === 'style' && <Code size={16} className="text-blue-500 shrink-0" />}
                              <span className="font-semibold text-sm">{finding.title}</span>
                            </div>
                            <Badge variant={finding.severity === 'critical' ? 'destructive' : 'outline'} className="text-[10px] uppercase px-2 py-0 h-5">
                              {finding.severity}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-3">{finding.description}</p>
                          
                          <div className="bg-muted/50 rounded-md p-3 text-sm">
                            <div className="flex items-start gap-2">
                              <CheckCircle2 size={16} className="text-green-500 mt-0.5 shrink-0" />
                              <span className="text-foreground/80">{finding.suggestion}</span>
                            </div>
                          </div>
                          
                          {finding.line && (
                            <div className="mt-3 text-xs font-mono text-muted-foreground flex items-center gap-1">
                              <ArrowRight size={12} /> Line {finding.line}
                            </div>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              
              {result.findings.length === 0 && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-6 text-center text-green-600 dark:text-green-400">
                  <CheckCircle2 size={32} className="mx-auto mb-3" />
                  <h3 className="text-lg font-semibold mb-1">All Clear!</h3>
                  <p className="text-sm">No issues found in the provided code.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground bg-[radial-gradient(ellipse_at_center,rgba(var(--primary),0.05),transparent_50%)]">
            <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center mb-6 shadow-sm rotate-12 transition-transform hover:rotate-0 duration-300">
              <Shield className="text-muted-foreground/50" size={32} />
            </div>
            <h3 className="text-xl font-medium text-foreground mb-2">Ready for Audit</h3>
            <p className="max-w-sm text-sm">Paste your code in the left panel or provide a GitHub URL to begin the security analysis.</p>
          </div>
        )}

        <AnimatePresence>
          {fixedCode && (
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 h-[60%] bg-card border-t border-border shadow-2xl flex flex-col z-20"
            >
              <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-green-500" />
                  <span className="font-semibold text-sm">Auto-fixed Code</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" className="h-8 gap-2" onClick={() => copyToClipboard(fixedCode)}>
                    <Copy size={14} /> Copy
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => setFixedCode(null)}>
                    Close
                  </Button>
                </div>
              </div>
              <div className="flex-1 p-4 overflow-auto">
                <pre className="text-sm font-mono text-foreground/90 whitespace-pre-wrap">{fixedCode}</pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
