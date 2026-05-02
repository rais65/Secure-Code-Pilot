import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  X,
  Check,
  RotateCcw,
  GitCompare,
  Minus,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Diff Engine (LCS, line-level) ───────────────────────────────────────────

type DiffOp =
  | { type: "equal"; line: string }
  | { type: "delete"; line: string }
  | { type: "insert"; line: string };

type DiffRow = {
  type: "equal" | "delete" | "insert" | "change";
  leftLine: string | null;
  rightLine: string | null;
  leftNo: number | null;
  rightNo: number | null;
};

function computeDiff(original: string, fixed: string): DiffOp[] {
  const A = original.split("\n");
  const B = fixed.split("\n");
  const m = A.length;
  const n = B.length;

  // For large files use a fast shortcut to avoid O(mn) memory
  const LIMIT = 400;
  if (m > LIMIT || n > LIMIT) {
    const ops: DiffOp[] = [];
    A.forEach((l) => ops.push({ type: "delete", line: l }));
    B.forEach((l) => ops.push({ type: "insert", line: l }));
    return ops;
  }

  // Build LCS DP table
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        A[i - 1] === B[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const ops: DiffOp[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) {
      ops.unshift({ type: "equal", line: A[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "insert", line: B[j - 1] });
      j--;
    } else {
      ops.unshift({ type: "delete", line: A[i - 1] });
      i--;
    }
  }
  return ops;
}

function buildDiffRows(ops: DiffOp[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let leftNo = 1, rightNo = 1;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === "equal") {
      rows.push({ type: "equal", leftLine: op.line, rightLine: op.line, leftNo: leftNo++, rightNo: rightNo++ });
      i++;
    } else {
      // Collect contiguous delete+insert block
      const dels: string[] = [];
      const ins: string[] = [];
      while (i < ops.length && (ops[i].type === "delete" || ops[i].type === "insert")) {
        if (ops[i].type === "delete") dels.push(ops[i].line);
        else ins.push(ops[i].line);
        i++;
      }
      const len = Math.max(dels.length, ins.length);
      for (let k = 0; k < len; k++) {
        const hasDel = k < dels.length;
        const hasIns = k < ins.length;
        rows.push({
          type: hasDel && hasIns ? "change" : hasDel ? "delete" : "insert",
          leftLine: hasDel ? dels[k] : null,
          rightLine: hasIns ? ins[k] : null,
          leftNo: hasDel ? leftNo++ : null,
          rightNo: hasIns ? rightNo++ : null,
        });
      }
    }
  }
  return rows;
}

// ─── Diff Viewer ──────────────────────────────────────────────────────────────

const LINE_STYLES = {
  equal:  { left:  { bg: "transparent",            border: "transparent",             text: "rgba(200,210,230,0.55)", marker: " " },
             right: { bg: "transparent",            border: "transparent",             text: "rgba(200,210,230,0.55)", marker: " " } },
  delete: { left:  { bg: "rgba(255,45,85,0.10)",   border: "rgba(255,45,85,0.45)",    text: "#ffa0b0",               marker: "−" },
             right: { bg: "rgba(255,45,85,0.03)",   border: "transparent",             text: "transparent",           marker: " " } },
  insert: { left:  { bg: "rgba(34,197,94,0.03)",   border: "transparent",             text: "transparent",           marker: " " },
             right: { bg: "rgba(34,197,94,0.10)",   border: "rgba(34,197,94,0.45)",    text: "#90f0b0",               marker: "+" } },
  change: { left:  { bg: "rgba(255,45,85,0.10)",   border: "rgba(255,45,85,0.45)",    text: "#ffa0b0",               marker: "−" },
             right: { bg: "rgba(34,197,94,0.10)",   border: "rgba(34,197,94,0.45)",    text: "#90f0b0",               marker: "+" } },
};

function DiffCell({
  lineNo,
  content,
  side,
  rowType,
}: {
  lineNo: number | null;
  content: string | null;
  side: "left" | "right";
  rowType: DiffRow["type"];
}) {
  const st = LINE_STYLES[rowType][side];
  const isEmpty = content === null;

  return (
    <div
      className="flex min-w-0 h-full"
      style={{
        background: st.bg,
        borderLeft: side === "right" ? "none" : undefined,
        borderRight: side === "left" ? `2px solid ${st.border}` : undefined,
      }}
    >
      {/* Line number gutter */}
      <div
        className="w-10 shrink-0 text-right pr-2 py-0.5 select-none text-[10px] font-mono leading-5"
        style={{
          color: isEmpty ? "transparent" : "rgba(150,160,180,0.4)",
          background: "rgba(0,0,0,0.18)",
          borderRight: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {lineNo ?? ""}
      </div>
      {/* Marker (+/-/ ) */}
      <div
        className="w-4 shrink-0 text-center py-0.5 select-none text-[11px] font-bold leading-5"
        style={{ color: st.border, opacity: isEmpty ? 0 : 1 }}
      >
        {st.marker}
      </div>
      {/* Code content */}
      <div
        className="flex-1 min-w-0 py-0.5 px-1 overflow-hidden"
        style={{ color: isEmpty ? "transparent" : st.text }}
      >
        <span className="text-[11px] font-mono leading-5 whitespace-pre">
          {isEmpty ? "\u00a0" : content}
        </span>
      </div>
    </div>
  );
}

function DiffViewer({
  original,
  fixed,
  summary,
  issuesFixed,
  onAccept,
  onRevert,
}: {
  original: string;
  fixed: string;
  summary: string;
  issuesFixed: number;
  onAccept: () => void;
  onRevert: () => void;
}) {
  const ops = useMemo(() => computeDiff(original, fixed), [original, fixed]);
  const rows = useMemo(() => buildDiffRows(ops), [ops]);
  const added = useMemo(() => ops.filter((o) => o.type === "insert").length, [ops]);
  const removed = useMemo(() => ops.filter((o) => o.type === "delete").length, [ops]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Jump to first changed line on mount
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstChanged = rows.findIndex((r) => r.type !== "equal");
    if (firstChanged > 3) {
      const rowHeight = 22;
      el.scrollTop = Math.max(0, (firstChanged - 3) * rowHeight);
    }
  }, [rows]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "rgba(4,5,12,0.97)", backdropFilter: "blur(28px)" }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
            style={{
              background: "rgba(139,92,246,0.12)",
              border: "1px solid rgba(139,92,246,0.25)",
            }}
          >
            <GitCompare size={13} className="text-primary" />
            <span className="text-xs font-semibold text-primary">Diff Review</span>
          </div>
          <span className="text-xs text-muted-foreground hidden sm:block">{summary}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Stats */}
          <div className="flex items-center gap-2 mr-1">
            <span
              className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded"
              style={{ background: "rgba(34,197,94,0.12)", color: "#4ade80" }}
            >
              <Plus size={10} />+{added}
            </span>
            <span
              className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded"
              style={{ background: "rgba(255,45,85,0.12)", color: "#f87171" }}
            >
              <Minus size={10} />-{removed}
            </span>
          </div>

          {/* Revert */}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs font-semibold border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-300 transition-all"
            onClick={onRevert}
            style={{ boxShadow: "0 0 12px rgba(239,68,68,0.1)" }}
          >
            <RotateCcw size={12} />
            Revert
          </Button>

          {/* Accept */}
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs font-bold px-4"
            onClick={onAccept}
            style={{
              background: "rgba(34,197,94,0.2)",
              border: "1px solid rgba(34,197,94,0.5)",
              color: "#4ade80",
              boxShadow: "0 0 16px rgba(34,197,94,0.2)",
            }}
          >
            <Check size={13} />
            Accept Changes
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={onRevert}
          >
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div
        className="px-5 py-2 flex items-center gap-4 shrink-0 text-xs"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.2)" }}
      >
        <span className="text-muted-foreground">
          <span className="font-semibold text-foreground/70">{issuesFixed}</span>{" "}
          issue{issuesFixed !== 1 ? "s" : ""} fixed
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-muted-foreground truncate">{summary}</span>
      </div>

      {/* ── Column headers ── */}
      <div
        className="flex shrink-0 text-[10px] font-bold uppercase tracking-widest"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div
          className="w-1/2 flex items-center gap-2 px-5 py-2"
          style={{
            borderRight: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,45,85,0.04)",
            color: "rgba(255,120,140,0.7)",
          }}
        >
          <Minus size={11} />
          Before (Original)
        </div>
        <div
          className="w-1/2 flex items-center gap-2 px-5 py-2"
          style={{
            background: "rgba(34,197,94,0.04)",
            color: "rgba(100,220,140,0.7)",
          }}
        >
          <Plus size={11} />
          After (Fixed)
        </div>
      </div>

      {/* ── Diff rows (synchronized scroll via single container) ── */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {rows.map((row, idx) => (
          <div
            key={idx}
            className="flex"
            style={{
              minHeight: "22px",
              borderBottom: "1px solid rgba(255,255,255,0.02)",
            }}
          >
            {/* Left (original) */}
            <div
              className="w-1/2 flex min-w-0"
              style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}
            >
              <DiffCell
                lineNo={row.leftNo}
                content={row.leftLine}
                side="left"
                rowType={row.type}
              />
            </div>
            {/* Right (fixed) */}
            <div className="w-1/2 flex min-w-0">
              <DiffCell
                lineNo={row.rightNo}
                content={row.rightLine}
                side="right"
                rowType={row.type}
              />
            </div>
          </div>
        ))}

        {/* Bottom padding */}
        <div className="h-20" />
      </div>

      {/* ── Sticky bottom action bar ── */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(12px)",
        }}
      >
        <span className="text-xs text-muted-foreground">
          Review the changes carefully before accepting.
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs font-semibold border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-300 transition-all"
            onClick={onRevert}
          >
            <RotateCcw size={12} />
            Revert to Original
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs font-bold px-5"
            onClick={onAccept}
            style={{
              background: "rgba(34,197,94,0.2)",
              border: "1px solid rgba(34,197,94,0.5)",
              color: "#4ade80",
              boxShadow: "0 0 20px rgba(34,197,94,0.18)",
            }}
          >
            <Check size={13} />
            Accept & Apply
          </Button>
        </div>
      </div>
    </motion.div>
  );
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
    displayScore >= 80 ? "#22c55e" : displayScore >= 60 ? "#eab308" : displayScore >= 40 ? "#f97316" : "#ef4444";

  useEffect(() => {
    setDisplayScore(0);
    let frame: number;
    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min((now - start) / 1400, 1);
      setDisplayScore(Math.round((1 - Math.pow(1 - t, 3)) * score));
      if (t < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ filter: `drop-shadow(0 0 14px ${scoreColor}55)`, transition: "filter 0.6s" }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={strokeWidth} />
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none"
            stroke={scoreColor} strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference - progress}
            style={{ transition: "stroke-dashoffset 0.04s linear, stroke 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ color: scoreColor, transition: "color 0.6s" }}>
          <span className="text-3xl font-black tabular-nums leading-none">{displayScore}</span>
          <span className="text-[10px] uppercase tracking-widest font-semibold opacity-60 mt-0.5">Score</span>
        </div>
      </div>
    </div>
  );
}

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  critical_security: { label: "Critical Security", icon: Shield, color: "#ff2d55", glow: "rgba(255,45,85,0.22)", border: "rgba(255,45,85,0.45)", bg: "rgba(255,45,85,0.06)", badgeClass: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
  performance:       { label: "Performance",        icon: Zap,    color: "#f59e0b", glow: "rgba(245,158,11,0.18)", border: "rgba(245,158,11,0.4)",  bg: "rgba(245,158,11,0.05)", badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  style:             { label: "Style",              icon: Code,   color: "#3b82f6", glow: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.35)", bg: "rgba(59,130,246,0.05)", badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
} as const;

const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

// ─── Finding Card ─────────────────────────────────────────────────────────────

function FindingCard({ finding }: { finding: Finding }) {
  const cfg = CATEGORY_CONFIG[finding.category];
  const Icon = cfg.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className="rounded-xl overflow-hidden"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, boxShadow: `0 0 16px ${cfg.glow}, inset 0 1px 0 rgba(255,255,255,0.03)` }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={14} style={{ color: cfg.color }} className="shrink-0" />
            <span className="font-semibold text-sm text-foreground truncate">{finding.title}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {finding.line != null && (
              <span className="text-[10px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">L{finding.line}</span>
            )}
            <Badge variant="outline" className={`text-[10px] uppercase px-2 py-0 h-5 font-bold ${cfg.badgeClass}`}>{finding.severity}</Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{finding.description}</p>
        <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(255,255,255,0.03)", borderLeft: `3px solid ${cfg.color}` }}>
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
  const groups: Record<FindingCategory, Finding[]> = { critical_security: [], performance: [], style: [] };
  for (const f of findings) if (groups[f.category]) groups[f.category].push(f);
  for (const cat of Object.keys(groups) as FindingCategory[])
    groups[cat].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  return groups;
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportReport(result: AnalysisResult) {
  const sep = "─".repeat(50);
  const content = [
    "DEVGUARD QA — SECURITY AUDIT REPORT", "=".repeat(50),
    `Review ID  : ${result.reviewId}`,
    `Language   : ${result.language.toUpperCase()}`,
    `Score      : ${result.score}/100`,
    `Engine     : ${result.analysisEngine === "rule-based" ? "Rule-Based Analyzer" : "AI (GPT)"}`,
    `Generated  : ${new Date().toLocaleString()}`, "",
    "EXECUTIVE SUMMARY", sep, result.summary, "",
    "FINDINGS BREAKDOWN", sep,
    `Critical Security : ${result.criticalCount}`,
    `Performance       : ${result.performanceCount}`,
    `Style             : ${result.styleCount}`,
    `Total             : ${result.findings.length}`, "",
    "DETAILED FINDINGS", sep,
    ...result.findings.flatMap((f, i) => [
      `[${i + 1}] ${f.title}`,
      `    Category : ${f.category.replace("_", " ").toUpperCase()}`,
      `    Severity : ${f.severity.toUpperCase()}`,
      ...(f.line != null ? [`    Line     : ${f.line}`] : []),
      `    Issue    : ${f.description}`,
      `    Fix      : ${f.suggestion}`, "",
    ]),
    sep, "Generated by DevGuard QA — Autonomous Security Auditing Platform",
  ].join("\n");

  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `devguard-audit-${result.reviewId.slice(0, 8)}.txt` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Loading Overlay ──────────────────────────────────────────────────────────

function LoadingOverlay() {
  const [phase, setPhase] = useState(0);
  const phases = ["Analyzing Security Patterns...", "Scanning for Vulnerabilities...", "Checking Performance Issues...", "Validating Code Style...", "Generating Report..."];
  useEffect(() => { const t = setInterval(() => setPhase((p) => (p + 1) % phases.length), 1800); return () => clearInterval(t); }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
      <div className="relative w-28 h-28 mb-7">
        {[{ d: "0", c: "rgba(139,92,246,0.9)", c2: "rgba(139,92,246,0.22)", dur: "1s" },
          { d: "reverse", c: "rgba(99,102,241,0.6)", c2: "rgba(99,102,241,0.18)", dur: "1.1s", i: 3 },
          { d: "normal", c: "rgba(168,85,247,0.45)", c2: "transparent", dur: "1.8s", i: 6 }
        ].map(({ d, c, c2, dur, i = 0 }, idx) => (
          <div key={idx} className="absolute rounded-full animate-spin"
            style={{ inset: i, border: "2px solid transparent", borderTopColor: c, borderRightColor: c2, animationDuration: dur, animationDirection: d as "normal" | "reverse" }} />
        ))}
        <div className="absolute inset-0 flex items-center justify-center">
          <Shield className="text-primary animate-pulse" size={26} />
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.h3 key={phase} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.28 }} className="text-base font-semibold text-foreground mb-2">
          {phases[phase]}
        </motion.h3>
      </AnimatePresence>
      <p className="text-xs text-muted-foreground max-w-xs mb-6">Running heuristics, vulnerability detection, and performance checks...</p>
      <div className="flex gap-2">
        {[{ l: "Security", c: "#ff2d55", bg: "rgba(255,45,85,0.12)" }, { l: "Performance", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" }, { l: "Style", c: "#3b82f6", bg: "rgba(59,130,246,0.12)" }]
          .map(({ l, c, bg }, i) => (
            <span key={l} className="text-[10px] px-2.5 py-1 rounded-full font-semibold animate-pulse"
              style={{ animationDelay: `${i * 0.25}s`, background: bg, color: c }}>{l}</span>
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
  // originalCode stores the pre-fix snapshot so Revert can restore it exactly
  const [originalCode, setOriginalCode] = useState<string>("");
  const [showDiff, setShowDiff] = useState(false);
  const { toast } = useToast();
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const analyzeCodeMutation = useAnalyzeCode({
    mutation: {
      onSuccess: (data) => {
        const r = data as unknown as AnalysisResult;
        setResult(r);
        setFixResult(null);
        setShowDiff(false);
        setTimeout(() => rightPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 50);
        toast({
          title: "Analysis complete",
          description: `${r.findings.length} issue${r.findings.length !== 1 ? "s" : ""} found · Score ${r.score}/100${r.analysisEngine === "rule-based" ? " (rule-based)" : ""}`,
        });
      },
      onError: (err) => {
        toast({ title: "Analysis failed", description: err instanceof Error ? err.message : "Check your connection and try again.", variant: "destructive" });
      },
    },
  });

  const autofixCodeMutation = useAutofixCode({
    mutation: {
      onSuccess: (data) => {
        const r = data as unknown as AutofixResult;
        setFixResult(r);
        // Don't update the editor yet — show the diff first so user can review
        setShowDiff(true);
        toast({ title: "Diff ready", description: `${r.issuesFixed} fix${r.issuesFixed !== 1 ? "es" : ""} generated. Review the changes before accepting.` });
      },
      onError: (err) => {
        toast({ title: "Auto-fix failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
      },
    },
  });

  const isAnalyzing = analyzeCodeMutation.isPending;
  const isFixing = autofixCodeMutation.isPending;

  const handleAnalyze = useCallback(() => {
    if (!code.trim() && !githubUrl.trim()) {
      toast({ title: "No code provided", description: "Paste code or enter a GitHub URL.", variant: "destructive" });
      textareaRef.current?.focus();
      return;
    }
    setFixResult(null);
    setShowDiff(false);
    analyzeCodeMutation.mutate({ data: { code: code || "", language, githubUrl: githubUrl || undefined } });
  }, [code, language, githubUrl, analyzeCodeMutation, toast]);

  const handleAutofix = useCallback(() => {
    if (!result?.findings.length) {
      toast({ title: "Nothing to fix", description: "Run an analysis first.", variant: "destructive" });
      return;
    }
    if (!code.trim()) {
      toast({ title: "Editor is empty", description: "Paste code to fix.", variant: "destructive" });
      return;
    }
    // Snapshot original code BEFORE sending to the AI
    setOriginalCode(code);
    autofixCodeMutation.mutate({
      data: {
        code,
        language,
        findings: result.findings as unknown as Parameters<typeof autofixCodeMutation.mutate>[0]["data"]["findings"],
      },
    });
  }, [result, code, language, autofixCodeMutation, toast]);

  // User reviewed the diff and accepts the fixes
  const handleAccept = useCallback(() => {
    if (!fixResult) return;
    setCode(fixResult.fixedCode);
    setShowDiff(false);
    toast({
      title: "Changes accepted",
      description: "Fixed code applied to editor. Re-run analysis to verify.",
    });
  }, [fixResult, toast]);

  // User rejects — restore original
  const handleRevert = useCallback(() => {
    setCode(originalCode);
    setShowDiff(false);
    setFixResult(null);
    toast({ title: "Reverted to original", description: "No changes were applied." });
  }, [originalCode, toast]);

  const groups = result ? groupFindings(result.findings) : null;

  return (
    <>
      {/* ── Diff Viewer (full-screen overlay) ── */}
      <AnimatePresence>
        {showDiff && fixResult && (
          <DiffViewer
            original={originalCode}
            fixed={fixResult.fixedCode}
            summary={fixResult.changesSummary}
            issuesFixed={fixResult.issuesFixed}
            onAccept={handleAccept}
            onRevert={handleRevert}
          />
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* ── LEFT: Code Editor ── */}
        <div
          className="w-full md:w-1/2 flex flex-col border-b md:border-b-0 md:border-r border-border"
          style={isAnalyzing ? { boxShadow: "inset 0 0 40px rgba(139,92,246,0.07)" } : {}}
        >
          {/* Toolbar */}
          <div className="p-4 border-b border-border flex flex-col gap-3 shrink-0 bg-background/80 backdrop-blur-md z-10">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm flex items-center gap-2 text-foreground/90">
                <Code size={15} className="text-primary" />
                Target Source
              </h2>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-[140px] h-8 text-xs bg-card/80"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["typescript","javascript","python","go","rust","java","php","csharp"].map((l) => (
                    <SelectItem key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</SelectItem>
                  ))}
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
                className="gap-2 h-9 px-5 font-semibold"
                onClick={handleAnalyze}
                disabled={isAnalyzing || isFixing}
                style={{ boxShadow: "0 0 20px rgba(139,92,246,0.28), 0 2px 8px rgba(0,0,0,0.25)" }}
              >
                {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                {isAnalyzing ? "Scanning..." : "Analyze"}
              </Button>
            </div>
          </div>

          {/* Editor */}
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
            {isAnalyzing && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="w-full h-0.5 animate-scan-line"
                  style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.85), transparent)", boxShadow: "0 0 14px rgba(139,92,246,0.6)" }} />
              </div>
            )}
            {/* Diff review badge */}
            {fixResult && !isFixing && !showDiff && (
              <button
                onClick={() => setShowDiff(true)}
                className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold cursor-pointer transition-all hover:scale-105"
                style={{ background: "rgba(139,92,246,0.14)", border: "1px solid rgba(139,92,246,0.35)", color: "#a78bfa", boxShadow: "0 0 12px rgba(139,92,246,0.2)" }}
              >
                <GitCompare size={10} />
                Review Diff
              </button>
            )}
          </div>
        </div>

        {/* ── RIGHT: Results ── */}
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
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
                          style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}>
                          Rule-Based
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{result.summary}</p>
                  </div>
                  <Button
                    size="sm" variant="outline"
                    className="h-8 gap-1.5 text-xs font-medium hover:border-primary/50 hover:text-primary shrink-0 transition-all"
                    onClick={() => exportReport(result)}
                    style={{ boxShadow: "0 0 10px rgba(139,92,246,0.08)" }}
                  >
                    <Download size={12} />Export
                  </Button>
                </div>

                {/* Score + stat cards */}
                <div className="flex gap-3 items-stretch">
                  <div className="rounded-2xl p-4 flex flex-col items-center justify-center shrink-0"
                    style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 0 28px rgba(139,92,246,0.07)" }}>
                    <ScoreGauge score={result.score} />
                  </div>
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    {([
                      { cat: "critical_security" as const, count: result.criticalCount },
                      { cat: "performance" as const,       count: result.performanceCount },
                      { cat: "style" as const,             count: result.styleCount },
                    ]).map(({ cat, count }) => {
                      const cfg = CATEGORY_CONFIG[cat];
                      const Icon = cfg.icon;
                      return (
                        <div key={cat} className="rounded-xl p-3 flex flex-col items-center gap-1 text-center"
                          style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, boxShadow: `0 0 12px ${cfg.glow}` }}>
                          <Icon size={15} style={{ color: cfg.color }} />
                          <span className="text-2xl font-black leading-none" style={{ color: cfg.color }}>{count}</span>
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
                        className="h-7 gap-1.5 text-xs font-semibold px-3"
                        onClick={handleAutofix}
                        disabled={isFixing}
                        style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.32)", color: "#f59e0b", boxShadow: "0 0 12px rgba(245,158,11,0.16)" }}
                      >
                        {isFixing
                          ? <><Loader2 className="h-3 w-3 animate-spin" />Generating Fix...</>
                          : <><Wand2 className="h-3 w-3" />Auto-Fix All</>
                        }
                      </Button>
                    </div>

                    {(["critical_security", "performance", "style"] as FindingCategory[]).map((cat) => {
                      const catFindings = groups[cat];
                      if (!catFindings.length) return null;
                      const cfg = CATEGORY_CONFIG[cat];
                      return (
                        <div key={cat}>
                          <div className="flex items-center gap-2 mb-2.5">
                            <div className="h-px flex-1" style={{ background: `linear-gradient(to right, ${cfg.border}, transparent)` }} />
                            <span className="text-[10px] font-bold uppercase tracking-widest px-1" style={{ color: cfg.color }}>{cfg.label}</span>
                            <div className="h-px flex-1" style={{ background: `linear-gradient(to left, ${cfg.border}, transparent)` }} />
                          </div>
                          <div className="space-y-2">
                            {catFindings.map((f) => <FindingCard key={f.id} finding={f} />)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl p-8 text-center"
                    style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.18)", boxShadow: "0 0 28px rgba(34,197,94,0.07)" }}>
                    <CheckCircle2 size={34} className="mx-auto mb-3 text-green-500" />
                    <h3 className="text-base font-semibold text-green-400 mb-1">All Clear</h3>
                    <p className="text-xs text-muted-foreground">No issues detected. Code looks clean and secure.</p>
                  </div>
                )}
              </div>
            </div>
          ) : analyzeCodeMutation.isError ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", boxShadow: "0 0 20px rgba(239,68,68,0.12)" }}>
                <AlertTriangle size={24} className="text-red-400" />
              </div>
              <h3 className="font-semibold text-foreground mb-1">Analysis Failed</h3>
              <p className="text-xs text-muted-foreground max-w-xs mb-5">
                {analyzeCodeMutation.error instanceof Error ? analyzeCodeMutation.error.message : "An unexpected error occurred."}
              </p>
              <Button size="sm" variant="outline" onClick={handleAnalyze} className="text-xs gap-1.5">
                <Play size={11} className="fill-current" />Try Again
              </Button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center"
              style={{ background: "radial-gradient(ellipse at center, rgba(139,92,246,0.04) 0%, transparent 70%)" }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 transition-all duration-500 hover:scale-105"
                style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", boxShadow: "0 0 28px rgba(139,92,246,0.1)" }}>
                <Shield className="text-primary/40" size={27} />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-2">Ready for Audit</h3>
              <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                Paste your code in the left panel or provide a GitHub URL to begin the security analysis.
              </p>
              <div className="flex flex-wrap gap-2 mt-6 justify-center">
                {["SQL Injection", "XSS", "SSRF", "Hardcoded Secrets", "Memory Leaks"].map((tag) => (
                  <span key={tag} className="text-[10px] px-2.5 py-1 rounded-full text-muted-foreground"
                    style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Fixing overlay on right panel */}
          <AnimatePresence>
            {isFixing && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center z-20"
                style={{ background: "rgba(4,5,14,0.82)", backdropFilter: "blur(8px)" }}
              >
                <div className="relative w-16 h-16 mb-4">
                  <div className="absolute inset-0 rounded-full animate-spin"
                    style={{ border: "2px solid transparent", borderTopColor: "#f59e0b", boxShadow: "0 0 20px rgba(245,158,11,0.3)" }} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Wand2 className="text-amber-400 animate-pulse" size={22} />
                  </div>
                </div>
                <p className="text-sm font-semibold text-amber-300 mb-1">Generating Fixes...</p>
                <p className="text-xs text-muted-foreground">AI is rewriting your code</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
