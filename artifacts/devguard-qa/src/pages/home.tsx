import { useState, useEffect, useRef, useCallback } from "react";
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
import {
  Shield,
  Zap,
  Code,
  CheckCircle2,
  Play,
  GitBranch,
  Copy,
  Loader2,
  ArrowRight,
  Download,
  AlertTriangle,
  Wand2,
  PenLine,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  analysisEngine?: "ai" | "rule-based";
}

interface AutofixResult {
  fixedCode: string;
  changesSummary: string;
  issuesFixed: number;
}

// ─── Score Gauge ──────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const [displayScore, setDisplayScore] = useState(0);
  const size = 124;
  const strokeWidth = 11;
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

  useEffect(() => {
    setDisplayScore(0);
    let frame: number;
    const start = performance.now();
    const duration = 1400;
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
        style={{
          filter: `drop-shadow(0 0 16px ${scoreColor}66)`,
          transition: "filter 0.6s",
        }}
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
            style={{ transition: "stroke-dashoffset 0.04s linear, stroke 0.6s ease" }}
          />
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ color: scoreColor, transition: "color 0.6s" }}
        >
          <span className="text-3xl font-black tabular-nums leading-none">{displayScore}</span>
          <span className="text-[10px] uppercase tracking-widest font-semibold opacity-60 mt-0.5">
            Score
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  critical_security: {
    label: "Critical Security",
    icon: Shield,
    color: "#ff2d55",
    glow: "rgba(255,45,85,0.22)",
    border: "rgba(255,45,85,0.45)",
    bg: "rgba(255,45,85,0.06)",
    badgeClass: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  },
  performance: {
    label: "Performance",
    icon: Zap,
    color: "#f59e0b",
    glow: "rgba(245,158,11,0.18)",
    border: "rgba(245,158,11,0.4)",
    bg: "rgba(245,158,11,0.05)",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  style: {
    label: "Style",
    icon: Code,
    color: "#3b82f6",
    glow: "rgba(59,130,246,0.18)",
    border: "rgba(59,130,246,0.35)",
    bg: "rgba(59,130,246,0.05)",
    badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
} as const;

const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

// ─── Finding Card ─────────────────────────────────────────────────────────────

function FindingCard({ finding }: { finding: Finding }) {
  const cfg = CATEGORY_CONFIG[finding.category];
  const Icon = cfg.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="rounded-xl overflow-hidden"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        boxShadow: `0 0 18px ${cfg.glow}, inset 0 1px 0 rgba(255,255,255,0.03)`,
      }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={14} style={{ color: cfg.color }} className="shrink-0" />
            <span className="font-semibold text-sm text-foreground truncate">{finding.title}</span>
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
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{finding.description}</p>
        <div
          className="rounded-lg p-3 text-xs"
          style={{ background: "rgba(255,255,255,0.03)", borderLeft: `3px solid ${cfg.color}` }}
        >
          <div className="flex items-start gap-2">
            <ArrowRight size={11} style={{ color: cfg.color }} className="mt-0.5 shrink-0" />
            <span className="text-foreground/75 leading-relaxed">{finding.suggestion}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Group findings ───────────────────────────────────────────────────────────

function groupFindings(findings: Finding[]) {
  const groups: Record<FindingCategory, Finding[]> = {
    critical_security: [],
    performance: [],
    style: [],
  };
  for (const f of findings) {
    if (groups[f.category]) groups[f.category].push(f);
  }
  for (const cat of Object.keys(groups) as FindingCategory[]) {
    groups[cat].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    );
  }
  return groups;
}

// ─── Export report ────────────────────────────────────────────────────────────

function exportReport(result: AnalysisResult) {
  const sep = "─".repeat(50);
  const lines: string[] = [
    "DEVGUARD QA — SECURITY AUDIT REPORT",
    "=".repeat(50),
    `Review ID  : ${result.reviewId}`,
    `Language   : ${result.language.toUpperCase()}`,
    `Score      : ${result.score}/100`,
    `Engine     : ${result.analysisEngine === "rule-based" ? "Rule-Based Analyzer" : "AI (GPT)"}`,
    `Generated  : ${new Date().toLocaleString()}`,
    "",
    "EXECUTIVE SUMMARY",
    sep,
    result.summary,
    "",
    `FINDINGS BREAKDOWN`,
    sep,
    `Critical Security : ${result.criticalCount}`,
    `Performance       : ${result.performanceCount}`,
    `Style             : ${result.styleCount}`,
    `Total             : ${result.findings.length}`,
    "",
    "DETAILED FINDINGS",
    sep,
    ...result.findings.flatMap((f, i) => [
      `[${i + 1}] ${f.title}`,
      `    Category : ${f.category.replace("_", " ").toUpperCase()}`,
      `    Severity : ${f.severity.toUpperCase()}`,
      ...(f.line != null ? [`    Line     : ${f.line}`] : []),
      `    Issue    : ${f.description}`,
      `    Fix      : ${f.suggestion}`,
      "",
    ]),
    sep,
    "Generated by DevGuard QA — Autonomous Security Auditing Platform",
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `devguard-audit-${result.reviewId.slice(0, 8)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Loading Overlay ──────────────────────────────────────────────────────────

function LoadingOverlay() {
  const [phase, setPhase] = useState(0);
  const phases = [
    "Analyzing Security Patterns...",
    "Scanning for Vulnerabilities...",
    "Checking Performance Issues...",
    "Validating Code Style...",
    "Generating Report...",
  ];

  useEffect(() => {
    const interval = setInterval(() => setPhase((p) => (p + 1) % phases.length), 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
      <div className="relative w-28 h-28 mb-7">
        <div
          className="absolute inset-0 rounded-full animate-spin"
          style={{
            border: "2px solid transparent",
            borderTopColor: "rgba(139,92,246,0.9)",
            borderRightColor: "rgba(139,92,246,0.25)",
            boxShadow: "0 0 24px rgba(139,92,246,0.35)",
          }}
        />
        <div
          className="absolute inset-3 rounded-full animate-spin"
          style={{
            border: "2px solid transparent",
            borderTopColor: "rgba(99,102,241,0.6)",
            borderLeftColor: "rgba(99,102,241,0.2)",
            animationDirection: "reverse",
            animationDuration: "1.1s",
          }}
        />
        <div
          className="absolute inset-6 rounded-full animate-spin"
          style={{
            border: "2px solid transparent",
            borderTopColor: "rgba(168,85,247,0.5)",
            animationDuration: "1.8s",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Shield className="text-primary animate-pulse" size={26} />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.h3
          key={phase}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3 }}
          className="text-base font-semibold text-foreground mb-2"
        >
          {phases[phase]}
        </motion.h3>
      </AnimatePresence>

      <p className="text-xs text-muted-foreground max-w-xs mb-6">
        Running heuristics, vulnerability detection, and performance checks...
      </p>

      <div className="flex gap-2">
        {[
          { label: "Security", color: "#ff2d55", bg: "rgba(255,45,85,0.12)" },
          { label: "Performance", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
          { label: "Style", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
        ].map(({ label, color, bg }, i) => (
          <span
            key={label}
            className="text-[10px] px-2.5 py-1 rounded-full font-semibold animate-pulse"
            style={{ animationDelay: `${i * 0.25}s`, background: bg, color }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("typescript");
  const [githubUrl, setGithubUrl] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fixResult, setFixResult] = useState<AutofixResult | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const { toast } = useToast();
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const analyzeCodeMutation = useAnalyzeCode({
    mutation: {
      onSuccess: (data) => {
        const r = data as unknown as AnalysisResult;
        setResult(r);
        setFixResult(null);
        setShowDrawer(false);
        setTimeout(() => rightPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 50);
        const engineLabel = r.analysisEngine === "rule-based" ? " (rule-based scan)" : "";
        toast({
          title: "Analysis complete",
          description: `Found ${r.findings.length} issue${r.findings.length !== 1 ? "s" : ""}. Score: ${r.score}/100${engineLabel}`,
        });
      },
      onError: (err) => {
        const msg =
          err instanceof Error
            ? err.message
            : "Analysis failed. Check your connection and try again.";
        toast({ title: "Analysis failed", description: msg, variant: "destructive" });
      },
    },
  });

  const autofixCodeMutation = useAutofixCode({
    mutation: {
      onSuccess: (data) => {
        const r = data as unknown as AutofixResult;
        setFixResult(r);
        // Programmatically update the editor with the fixed code
        setCode(r.fixedCode);
        setShowDrawer(true);
        toast({
          title: "Auto-fix applied",
          description: `Fixed ${r.issuesFixed} issue${r.issuesFixed !== 1 ? "s" : ""}. Editor updated with corrected code.`,
        });
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : "Auto-fix failed. Please try again.";
        toast({ title: "Auto-fix failed", description: msg, variant: "destructive" });
      },
    },
  });

  const isAnalyzing = analyzeCodeMutation.isPending;
  const isFixing = autofixCodeMutation.isPending;

  const handleAnalyze = useCallback(() => {
    const hasCode = code.trim().length > 0;
    const hasUrl = githubUrl.trim().length > 0;

    if (!hasCode && !hasUrl) {
      toast({
        title: "No code provided",
        description: "Paste your code in the editor or enter a GitHub URL before analyzing.",
        variant: "destructive",
      });
      textareaRef.current?.focus();
      return;
    }

    setFixResult(null);
    setShowDrawer(false);
    analyzeCodeMutation.mutate({
      data: { code: code || "", language, githubUrl: githubUrl || undefined },
    });
  }, [code, language, githubUrl, analyzeCodeMutation, toast]);

  const handleAutofix = useCallback(() => {
    if (!result?.findings.length) {
      toast({ title: "Nothing to fix", description: "Run an analysis first.", variant: "destructive" });
      return;
    }
    if (!code.trim()) {
      toast({ title: "No code in editor", description: "The editor is empty.", variant: "destructive" });
      return;
    }
    autofixCodeMutation.mutate({
      data: {
        code,
        language,
        findings: result.findings as unknown as Parameters<
          typeof autofixCodeMutation.mutate
        >[0]["data"]["findings"],
      },
    });
  }, [result, code, language, autofixCodeMutation, toast]);

  const applyFixToEditor = useCallback(() => {
    if (!fixResult) return;
    setCode(fixResult.fixedCode);
    setShowDrawer(false);
    toast({ title: "Fix applied to editor", description: "Re-run analysis to verify the changes." });
  }, [fixResult, toast]);

  const groups = result ? groupFindings(result.findings) : null;

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
      {/* ── LEFT PANEL ── */}
      <div
        className="w-full md:w-1/2 flex flex-col border-b md:border-b-0 md:border-r border-border"
        style={
          isAnalyzing
            ? { boxShadow: "inset 0 0 40px rgba(139,92,246,0.07), 0 0 0 1px rgba(139,92,246,0.12)" }
            : {}
        }
      >
        {/* toolbar */}
        <div className="p-4 border-b border-border flex flex-col gap-3 shrink-0 bg-background/80 backdrop-blur-md z-10">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-2 text-foreground/90">
              <Code size={15} className="text-primary" />
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
                onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              />
            </div>
            <Button
              size="sm"
              className="gap-2 h-9 px-5 font-semibold relative overflow-hidden"
              onClick={handleAnalyze}
              disabled={isAnalyzing || isFixing}
              style={{ boxShadow: "0 0 20px rgba(139,92,246,0.28), 0 2px 8px rgba(0,0,0,0.25)" }}
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

        {/* editor */}
        <div className="flex-1 relative overflow-hidden">
          <Textarea
            ref={textareaRef}
            placeholder="Paste your code here for security analysis..."
            className="w-full h-full min-h-[300px] md:min-h-full resize-none border-0 focus-visible:ring-0 rounded-none font-mono text-xs p-4 bg-transparent leading-relaxed text-foreground/85 placeholder:text-muted-foreground/30"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            disabled={isAnalyzing}
          />

          {/* scan-line animation overlay */}
          {isAnalyzing && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div
                className="w-full h-0.5 animate-scan-line"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(139,92,246,0.85), transparent)",
                  boxShadow: "0 0 14px rgba(139,92,246,0.6)",
                }}
              />
            </div>
          )}

          {/* fixed-code indicator badge */}
          {fixResult && !isFixing && (
            <div
              className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold"
              style={{
                background: "rgba(34,197,94,0.12)",
                border: "1px solid rgba(34,197,94,0.3)",
                color: "#22c55e",
                boxShadow: "0 0 12px rgba(34,197,94,0.15)",
              }}
            >
              <CheckCircle2 size={10} />
              Auto-fixed
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div
        className="w-full md:w-1/2 flex flex-col bg-background relative overflow-hidden"
        style={result ? { boxShadow: "inset 0 0 60px rgba(139,92,246,0.03)" } : {}}
      >
        {isAnalyzing ? (
          <LoadingOverlay />
        ) : result ? (
          <div ref={rightPanelRef} className="flex-1 overflow-y-auto">
            <div className="p-5 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h2 className="text-lg font-bold tracking-tight">Audit Complete</h2>
                    {result.analysisEngine === "rule-based" && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
                        style={{
                          background: "rgba(245,158,11,0.12)",
                          color: "#f59e0b",
                          border: "1px solid rgba(245,158,11,0.25)",
                        }}
                      >
                        Rule-Based
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {result.summary}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs font-medium hover:border-primary/50 hover:text-primary shrink-0 transition-all"
                  onClick={() => exportReport(result)}
                  style={{ boxShadow: "0 0 10px rgba(139,92,246,0.08)" }}
                >
                  <Download size={12} />
                  Export
                </Button>
              </div>

              {/* Score + stat cards */}
              <div className="flex gap-3 items-stretch">
                <div
                  className="rounded-2xl p-4 flex flex-col items-center justify-center shrink-0"
                  style={{
                    background: "rgba(255,255,255,0.025)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    boxShadow: "0 0 28px rgba(139,92,246,0.07)",
                  }}
                >
                  <ScoreGauge score={result.score} />
                </div>

                <div className="flex-1 grid grid-cols-3 gap-2">
                  {(
                    [
                      { cat: "critical_security" as const, count: result.criticalCount },
                      { cat: "performance" as const, count: result.performanceCount },
                      { cat: "style" as const, count: result.styleCount },
                    ]
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
                        <Icon size={15} style={{ color: cfg.color }} />
                        <span className="text-2xl font-black leading-none" style={{ color: cfg.color }}>
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

              {/* Findings section */}
              {result.findings.length > 0 && groups ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground/90">
                      Findings{" "}
                      <span className="text-muted-foreground font-normal">({result.findings.length})</span>
                    </h3>
                    <Button
                      size="sm"
                      className="h-7 gap-1.5 text-xs font-semibold px-3"
                      onClick={handleAutofix}
                      disabled={isFixing}
                      style={{
                        background: "rgba(245,158,11,0.13)",
                        border: "1px solid rgba(245,158,11,0.32)",
                        color: "#f59e0b",
                        boxShadow: "0 0 12px rgba(245,158,11,0.18)",
                      }}
                    >
                      {isFixing ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Fixing...
                        </>
                      ) : (
                        <>
                          <Wand2 className="h-3 w-3" />
                          Auto-Fix All
                        </>
                      )}
                    </Button>
                  </div>

                  {(["critical_security", "performance", "style"] as FindingCategory[]).map((cat) => {
                    const catFindings = groups[cat];
                    if (!catFindings.length) return null;
                    const cfg = CATEGORY_CONFIG[cat];
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-2 mb-2.5">
                          <div
                            className="h-px flex-1"
                            style={{
                              background: `linear-gradient(to right, ${cfg.border}, transparent)`,
                            }}
                          />
                          <span
                            className="text-[10px] font-bold uppercase tracking-widest px-1"
                            style={{ color: cfg.color }}
                          >
                            {cfg.label}
                          </span>
                          <div
                            className="h-px flex-1"
                            style={{
                              background: `linear-gradient(to left, ${cfg.border}, transparent)`,
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          {catFindings.map((f) => (
                            <FindingCard key={f.id} finding={f} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  className="rounded-2xl p-8 text-center"
                  style={{
                    background: "rgba(34,197,94,0.05)",
                    border: "1px solid rgba(34,197,94,0.18)",
                    boxShadow: "0 0 28px rgba(34,197,94,0.07)",
                  }}
                >
                  <CheckCircle2 size={34} className="mx-auto mb-3 text-green-500" />
                  <h3 className="text-base font-semibold text-green-400 mb-1">All Clear</h3>
                  <p className="text-xs text-muted-foreground">
                    No issues detected. Code looks clean and secure.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : analyzeCodeMutation.isError ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                boxShadow: "0 0 20px rgba(239,68,68,0.12)",
              }}
            >
              <AlertTriangle size={24} className="text-red-400" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Analysis Failed</h3>
            <p className="text-xs text-muted-foreground max-w-xs mb-5">
              {analyzeCodeMutation.error instanceof Error
                ? analyzeCodeMutation.error.message
                : "An unexpected error occurred. Please try again."}
            </p>
            <Button size="sm" variant="outline" onClick={handleAnalyze} className="text-xs gap-1.5">
              <Play size={11} className="fill-current" />
              Try Again
            </Button>
          </div>
        ) : (
          /* Ready state */
          <div
            className="flex-1 flex flex-col items-center justify-center p-8 text-center"
            style={{
              background: "radial-gradient(ellipse at center, rgba(139,92,246,0.04) 0%, transparent 70%)",
            }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 transition-all duration-500 hover:scale-105"
              style={{
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.07)",
                boxShadow: "0 0 28px rgba(139,92,246,0.1)",
              }}
            >
              <Shield className="text-primary/40" size={27} />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-2">Ready for Audit</h3>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              Paste your code in the left panel or provide a GitHub URL to begin the security analysis.
            </p>
            <div className="flex flex-wrap gap-2 mt-6 justify-center">
              {["SQL Injection", "XSS", "SSRF", "Hardcoded Secrets", "Memory Leaks"].map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-2.5 py-1 rounded-full text-muted-foreground"
                  style={{
                    background: "rgba(255,255,255,0.035)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Auto-fix Drawer ── */}
        <AnimatePresence>
          {showDrawer && fixResult && (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 230 }}
              className="absolute bottom-0 left-0 right-0 flex flex-col z-30"
              style={{
                height: "55%",
                background: "rgba(8,10,20,0.94)",
                borderTop: "1px solid rgba(34,197,94,0.28)",
                boxShadow: "0 -20px 60px rgba(34,197,94,0.07)",
                backdropFilter: "blur(24px)",
              }}
            >
              {/* Drawer header */}
              <div
                className="flex items-center justify-between px-4 py-3 shrink-0"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-green-400" />
                  <span className="text-sm font-semibold text-green-300">
                    Auto-fixed — {fixResult.issuesFixed} issue{fixResult.issuesFixed !== 1 ? "s" : ""} resolved
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(fixResult.fixedCode)
                        .then(() => toast({ title: "Copied to clipboard" }))
                    }
                  >
                    <Copy size={11} />
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 text-[11px] font-semibold px-3"
                    onClick={applyFixToEditor}
                    style={{
                      background: "rgba(34,197,94,0.18)",
                      border: "1px solid rgba(34,197,94,0.35)",
                      color: "#22c55e",
                      boxShadow: "0 0 10px rgba(34,197,94,0.2)",
                    }}
                  >
                    <PenLine size={11} />
                    Apply to Editor
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowDrawer(false)}
                  >
                    <X size={13} />
                  </Button>
                </div>
              </div>

              {/* Changes summary */}
              <div
                className="px-4 py-2 shrink-0 text-xs text-muted-foreground"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              >
                <span className="font-medium text-foreground/70">Changes: </span>
                {fixResult.changesSummary}
              </div>

              {/* Fixed code preview */}
              <div className="flex-1 overflow-auto p-4">
                <pre className="text-xs font-mono text-green-200/75 whitespace-pre-wrap leading-relaxed">
                  {fixResult.fixedCode}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
