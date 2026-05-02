import { useState, useEffect, useRef } from "react";
import { useAnalyzeCode, useAutofixCode } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Shield, Zap, Code, CheckCircle2, Play, GitBranch, Copy, Loader2, ArrowRight, Download, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

type FindingCategory = "critical_security" | "performance" | "style";
type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

interface Finding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  line?: number;
  suggestion: string;
}

interface AnalysisResult {
  reviewId: string;
  language: string;
  findings: Finding[];
  summary: string;
  score: number;
  criticalCount: number;
  performanceCount: number;
  styleCount: number;
}

function ScoreGauge({ score }: { score: number }) {
  const [displayScore, setDisplayScore] = useState(0);
  const size = 120;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (displayScore / 100) * circumference;
  const scoreColor =
    displayScore >= 80
      ? "#22c55e"
      : displayScore >= 60
      ? "#eab308"
      : displayScore >= 40
      ? "#f97316"
      : "#ef4444";
  const glowColor =
    displayScore >= 80
      ? "0 0 20px rgba(34,197,94,0.5)"
      : displayScore >= 60
      ? "0 0 20px rgba(234,179,8,0.5)"
      : "0 0 20px rgba(239,68,68,0.5)";

  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const duration = 1200;
    const animate = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(eased * score));
      if (t < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="relative"
        style={{ filter: `drop-shadow(${glowColor})` }}
      >
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={scoreColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            style={{ transition: "stroke-dashoffset 0.05s, stroke 0.5s" }}
          />
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ color: scoreColor }}
        >
          <span className="text-3xl font-black tabular-nums leading-none">
            {displayScore}
          </span>
          <span className="text-[10px] uppercase tracking-widest font-semibold opacity-70 mt-0.5">
            Score
          </span>
        </div>
      </div>
    </div>
  );
}

const CATEGORY_CONFIG = {
  critical_security: {
    label: "Critical Security",
    icon: Shield,
    color: "#ff2d55",
    glow: "rgba(255,45,85,0.25)",
    border: "rgba(255,45,85,0.5)",
    bg: "rgba(255,45,85,0.07)",
    badgeClass: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  },
  performance: {
    label: "Performance",
    icon: Zap,
    color: "#f59e0b",
    glow: "rgba(245,158,11,0.2)",
    border: "rgba(245,158,11,0.45)",
    bg: "rgba(245,158,11,0.06)",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  style: {
    label: "Style",
    icon: Code,
    color: "#3b82f6",
    glow: "rgba(59,130,246,0.2)",
    border: "rgba(59,130,246,0.4)",
    bg: "rgba(59,130,246,0.06)",
    badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
} as const;

const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

function FindingCard({ finding }: { finding: Finding }) {
  const cfg = CATEGORY_CONFIG[finding.category];
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl overflow-hidden"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        boxShadow: `0 0 18px ${cfg.glow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={15} style={{ color: cfg.color }} className="shrink-0" />
            <span className="font-semibold text-sm text-foreground truncate">
              {finding.title}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {finding.line != null && (
              <span className="text-[10px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                L{finding.line}
              </span>
            )}
            <Badge
              variant="outline"
              className={`text-[10px] uppercase px-2 py-0 h-5 font-bold ${cfg.badgeClass}`}
            >
              {finding.severity}
            </Badge>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {finding.description}
        </p>

        <div
          className="rounded-lg p-3 text-xs"
          style={{
            background: "rgba(255,255,255,0.03)",
            borderLeft: `3px solid ${cfg.color}`,
          }}
        >
          <div className="flex items-start gap-2">
            <ArrowRight size={12} style={{ color: cfg.color }} className="mt-0.5 shrink-0" />
            <span className="text-foreground/75 leading-relaxed">{finding.suggestion}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function groupFindings(findings: Finding[]) {
  const groups: Record<FindingCategory, Finding[]> = {
    critical_security: [],
    performance: [],
    style: [],
  };
  for (const f of findings) {
    groups[f.category].push(f);
  }
  for (const cat of Object.keys(groups) as FindingCategory[]) {
    groups[cat].sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    );
  }
  return groups;
}

function handleDownloadPDF(result: AnalysisResult) {
  const content = `
DEVGUARD QA — SECURITY AUDIT REPORT
=====================================
Review ID: ${result.reviewId}
Language: ${result.language}
Score: ${result.score}/100
Generated: ${new Date().toLocaleString()}

SUMMARY
-------
${result.summary}

FINDINGS (${result.findings.length} total)
${result.criticalCount} Critical Security  |  ${result.performanceCount} Performance  |  ${result.styleCount} Style

${result.findings
  .map(
    (f, i) => `
[${i + 1}] ${f.title}
Category: ${f.category.replace("_", " ").toUpperCase()}
Severity: ${f.severity.toUpperCase()}
${f.line != null ? `Line: ${f.line}` : ""}
Description: ${f.description}
Fix: ${f.suggestion}
`
  )
  .join("\n---\n")}
  `.trim();

  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `devguard-audit-${result.reviewId.slice(0, 8)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("typescript");
  const [githubUrl, setGithubUrl] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fixedCode, setFixedCode] = useState<string | null>(null);
  const { toast } = useToast();
  const rightPanelRef = useRef<HTMLDivElement>(null);

  const analyzeCodeMutation = useAnalyzeCode({
    mutation: {
      onSuccess: (data) => {
        setResult(data as unknown as AnalysisResult);
        setTimeout(() => rightPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 50);
        toast({
          title: "Analysis complete",
          description: `Found ${(data as unknown as AnalysisResult).findings.length} issues. Score: ${(data as unknown as AnalysisResult).score}/100`,
        });
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : "Analysis failed. Please try again.";
        toast({
          title: "Analysis failed",
          description: msg,
          variant: "destructive",
        });
      },
    },
  });

  const autofixCodeMutation = useAutofixCode({
    mutation: {
      onSuccess: (data) => {
        setFixedCode((data as unknown as { fixedCode: string; issuesFixed: number }).fixedCode);
        toast({
          title: "Auto-fix complete",
          description: `Fixed ${(data as unknown as { issuesFixed: number }).issuesFixed} issues.`,
        });
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : "Auto-fix failed.";
        toast({ title: "Auto-fix failed", description: msg, variant: "destructive" });
      },
    },
  });

  const isAnalyzing = analyzeCodeMutation.isPending;
  const isFixing = autofixCodeMutation.isPending;

  const handleAnalyze = () => {
    if (!code.trim() && !githubUrl.trim()) {
      toast({
        title: "Input required",
        description: "Paste code or provide a GitHub URL.",
        variant: "destructive",
      });
      return;
    }
    setFixedCode(null);
    analyzeCodeMutation.mutate({
      data: { code, language, githubUrl: githubUrl || undefined },
    });
  };

  const handleAutofix = () => {
    if (!result?.findings.length) return;
    autofixCodeMutation.mutate({
      data: {
        code,
        language,
        findings: result.findings as unknown as Parameters<typeof autofixCodeMutation.mutate>[0]["data"]["findings"],
      },
    });
  };

  const groups = result ? groupFindings(result.findings) : null;

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
      {/* LEFT PANEL */}
      <div
        className="w-full md:w-1/2 flex flex-col border-b md:border-b-0 md:border-r border-border transition-all duration-300"
        style={
          isAnalyzing
            ? { boxShadow: "inset 0 0 40px rgba(139,92,246,0.08), 0 0 0 1px rgba(139,92,246,0.15)" }
            : {}
        }
      >
        <div className="p-4 border-b border-border flex flex-col gap-3 shrink-0 bg-background/70 backdrop-blur-md z-10">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-2 text-foreground/90">
              <Code size={16} className="text-primary" />
              Target Source
            </h2>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-[140px] h-8 text-xs bg-card/80">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="typescript">TypeScript</SelectItem>
                <SelectItem value="javascript">JavaScript</SelectItem>
                <SelectItem value="python">Python</SelectItem>
                <SelectItem value="go">Go</SelectItem>
                <SelectItem value="rust">Rust</SelectItem>
                <SelectItem value="java">Java</SelectItem>
                <SelectItem value="php">PHP</SelectItem>
                <SelectItem value="csharp">C#</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <GitBranch className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Or paste GitHub URL..."
                className="pl-9 h-9 text-sm bg-card/80 font-mono text-xs"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              className="gap-2 h-9 px-5 font-semibold shadow-lg shadow-primary/25 relative overflow-hidden"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              style={{
                boxShadow: "0 0 20px rgba(139,92,246,0.3), 0 2px 8px rgba(0,0,0,0.3)",
              }}
            >
              {isAnalyzing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              {isAnalyzing ? "Scanning..." : "Analyze"}
            </Button>
          </div>
        </div>

        <div className="flex-1 relative overflow-hidden">
          <Textarea
            placeholder="Paste your code here for security analysis..."
            className="w-full h-full min-h-[300px] md:min-h-full resize-none border-0 focus-visible:ring-0 rounded-none font-mono text-xs p-4 bg-transparent leading-relaxed text-foreground/80 placeholder:text-muted-foreground/30"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
          />
          {isAnalyzing && (
            <div className="absolute inset-0 pointer-events-none">
              <div
                className="w-full h-0.5 animate-scan-line"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(139,92,246,0.8), transparent)",
                  boxShadow: "0 0 12px rgba(139,92,246,0.6)",
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div
        className="w-full md:w-1/2 flex flex-col bg-background relative"
        style={
          result
            ? { boxShadow: "inset 0 0 60px rgba(139,92,246,0.04)" }
            : {}
        }
      >
        {isAnalyzing ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="relative w-28 h-28 mb-6">
              <div
                className="absolute inset-0 rounded-full animate-spin"
                style={{
                  border: "2px solid transparent",
                  borderTopColor: "rgba(139,92,246,0.9)",
                  borderRightColor: "rgba(139,92,246,0.3)",
                  boxShadow: "0 0 20px rgba(139,92,246,0.4)",
                }}
              />
              <div
                className="absolute inset-3 rounded-full animate-spin"
                style={{
                  border: "2px solid transparent",
                  borderTopColor: "rgba(99,102,241,0.7)",
                  animationDirection: "reverse",
                  animationDuration: "1.2s",
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Shield className="text-primary animate-pulse" size={28} />
              </div>
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Scanning Codebase</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Running security heuristics, performance checks, and style validations...
            </p>
            <div className="flex gap-1.5 mt-5">
              {["Security", "Performance", "Style"].map((label, i) => (
                <span
                  key={label}
                  className="text-[10px] px-2 py-1 rounded-full font-medium animate-pulse"
                  style={{
                    animationDelay: `${i * 0.3}s`,
                    background: i === 0
                      ? "rgba(255,45,85,0.15)"
                      : i === 1
                      ? "rgba(245,158,11,0.15)"
                      : "rgba(59,130,246,0.15)",
                    color: i === 0 ? "#ff2d55" : i === 1 ? "#f59e0b" : "#3b82f6",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        ) : result ? (
          <div ref={rightPanelRef} className="flex-1 overflow-y-auto">
            <div className="p-5 space-y-5">
              {/* Header bar */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold tracking-tight mb-0.5">Audit Complete</h2>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {result.summary}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs font-medium hover:border-primary/50 hover:text-primary transition-all"
                    onClick={() => handleDownloadPDF(result)}
                    style={{ boxShadow: "0 0 12px rgba(139,92,246,0.1)" }}
                  >
                    <Download size={13} />
                    Export Report
                  </Button>
                </div>
              </div>

              {/* Score + stat cards */}
              <div className="flex gap-3 items-center">
                <div
                  className="rounded-2xl p-4 flex flex-col items-center justify-center shrink-0"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    boxShadow: "0 0 30px rgba(139,92,246,0.08)",
                  }}
                >
                  <ScoreGauge score={result.score} />
                </div>
                <div className="flex-1 grid grid-cols-3 gap-2">
                  {(
                    [
                      { cat: "critical_security", count: result.criticalCount },
                      { cat: "performance", count: result.performanceCount },
                      { cat: "style", count: result.styleCount },
                    ] as const
                  ).map(({ cat, count }) => {
                    const cfg = CATEGORY_CONFIG[cat];
                    const Icon = cfg.icon;
                    return (
                      <div
                        key={cat}
                        className="rounded-xl p-3 flex flex-col items-center gap-1 text-center"
                        style={{
                          background: cfg.bg,
                          border: `1px solid ${cfg.border}`,
                          boxShadow: `0 0 12px ${cfg.glow}`,
                        }}
                      >
                        <Icon size={16} style={{ color: cfg.color }} />
                        <span
                          className="text-2xl font-black leading-none"
                          style={{ color: cfg.color }}
                        >
                          {count}
                        </span>
                        <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold leading-tight">
                          {cat === "critical_security" ? "Critical" : cat === "performance" ? "Perf" : "Style"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Findings */}
              {result.findings.length > 0 && groups ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground/90">
                      Findings <span className="text-muted-foreground font-normal">({result.findings.length})</span>
                    </h3>
                    <Button
                      size="sm"
                      className="h-7 gap-1.5 text-xs font-medium px-3"
                      onClick={handleAutofix}
                      disabled={isFixing}
                      style={{
                        background: "rgba(245,158,11,0.15)",
                        border: "1px solid rgba(245,158,11,0.35)",
                        color: "#f59e0b",
                        boxShadow: "0 0 12px rgba(245,158,11,0.2)",
                      }}
                    >
                      {isFixing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Zap className="h-3 w-3" />
                      )}
                      {isFixing ? "Fixing..." : "Auto-Fix All"}
                    </Button>
                  </div>

                  {(["critical_security", "performance", "style"] as FindingCategory[]).map(
                    (cat) => {
                      const catFindings = groups[cat];
                      if (!catFindings.length) return null;
                      const cfg = CATEGORY_CONFIG[cat];
                      return (
                        <div key={cat}>
                          <div className="flex items-center gap-2 mb-2">
                            <div
                              className="h-px flex-1"
                              style={{ background: `linear-gradient(to right, ${cfg.border}, transparent)` }}
                            />
                            <span
                              className="text-[10px] font-bold uppercase tracking-widest px-2"
                              style={{ color: cfg.color }}
                            >
                              {cfg.label}
                            </span>
                            <div
                              className="h-px flex-1"
                              style={{ background: `linear-gradient(to left, ${cfg.border}, transparent)` }}
                            />
                          </div>
                          <div className="space-y-2">
                            {catFindings.map((f) => (
                              <FindingCard key={f.id} finding={f} />
                            ))}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              ) : (
                <div
                  className="rounded-2xl p-8 text-center"
                  style={{
                    background: "rgba(34,197,94,0.05)",
                    border: "1px solid rgba(34,197,94,0.2)",
                    boxShadow: "0 0 30px rgba(34,197,94,0.08)",
                  }}
                >
                  <CheckCircle2 size={36} className="mx-auto mb-3 text-green-500" />
                  <h3 className="text-base font-semibold text-green-400 mb-1">All Clear</h3>
                  <p className="text-xs text-muted-foreground">No issues detected in the provided code.</p>
                </div>
              )}
            </div>
          </div>
        ) : analyzeCodeMutation.isError ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                boxShadow: "0 0 20px rgba(239,68,68,0.15)",
              }}
            >
              <AlertTriangle size={24} className="text-red-400" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Analysis Failed</h3>
            <p className="text-xs text-muted-foreground max-w-xs mb-4">
              {analyzeCodeMutation.error instanceof Error
                ? analyzeCodeMutation.error.message
                : "An unexpected error occurred."}
            </p>
            <Button size="sm" variant="outline" onClick={handleAnalyze} className="text-xs">
              Try Again
            </Button>
          </div>
        ) : (
          <div
            className="flex-1 flex flex-col items-center justify-center p-8 text-center"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(139,92,246,0.04) 0%, transparent 70%)",
            }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 transition-all duration-500 hover:scale-105"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 0 30px rgba(139,92,246,0.12)",
              }}
            >
              <Shield className="text-primary/40" size={28} />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-2">Ready for Audit</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Paste your code in the left panel or provide a GitHub URL to begin the security
              analysis.
            </p>
            <div className="flex gap-2 mt-6">
              {["SQL Injection", "XSS", "SSRF", "Memory Leaks"].map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-2 py-1 rounded-full text-muted-foreground"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Auto-fix drawer */}
        <AnimatePresence>
          {fixedCode && (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="absolute bottom-0 left-0 right-0 h-[60%] flex flex-col z-20"
              style={{
                background: "rgba(10,10,20,0.92)",
                borderTop: "1px solid rgba(34,197,94,0.3)",
                boxShadow: "0 -20px 60px rgba(34,197,94,0.08)",
                backdropFilter: "blur(20px)",
              }}
            >
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-green-400" />
                  <span className="text-sm font-semibold text-green-300">Auto-fixed Code</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => navigator.clipboard.writeText(fixedCode).then(() =>
                      toast({ title: "Copied to clipboard" })
                    )}
                  >
                    <Copy size={12} /> Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => setFixedCode(null)}
                  >
                    Close
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <pre className="text-xs font-mono text-green-200/80 whitespace-pre-wrap leading-relaxed">
                  {fixedCode}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
