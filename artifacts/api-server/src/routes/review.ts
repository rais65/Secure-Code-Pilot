import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import { reviewsTable } from "@workspace/db";
import { AnalyzeCodeBody, AutofixCodeBody } from "@workspace/api-zod";
import crypto from "node:crypto";

const router = Router();

// ─── Language Detection ───────────────────────────────────────────────────────

function detectLanguage(code: string, hint?: string): string {
  if (hint && hint.trim()) return hint.trim();
  if (code.includes("<?php")) return "php";
  if (code.includes("def ") && code.includes(":") && !code.includes("{")) return "python";
  if (code.includes("fn ") && code.includes("->") && code.includes("let ")) return "rust";
  if (/^package\s+\w+/m.test(code) && code.includes("func ")) return "go";
  if (code.includes("public static void main") || /import\s+java\./.test(code)) return "java";
  if (code.includes("using System") || code.includes("namespace ") || code.includes("Console.Write")) return "csharp";
  if (code.includes("import React") || code.includes("JSX") || code.includes(".tsx")) return "typescript";
  if (code.includes("const ") || code.includes("let ") || code.includes("=>") || code.includes("interface ") || code.includes(": string") || code.includes(": number")) return "typescript";
  return "javascript";
}

// ─── Rule-Based Fallback Engine ───────────────────────────────────────────────

interface RuleFinding {
  id: string;
  category: "critical_security" | "performance" | "style";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  line?: number;
  suggestion: string;
}

interface Rule {
  pattern: RegExp;
  category: "critical_security" | "performance" | "style";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  suggestion: string;
}

const SECURITY_RULES: Rule[] = [
  {
    pattern: /\b(SECRET|API_KEY|APIKEY|ACCESS_KEY|AUTH_TOKEN|PRIVATE_KEY)\s*[=:]\s*["'][^"']{4,}/i,
    category: "critical_security", severity: "critical",
    title: "Hardcoded Secret Detected",
    description: "A secret key, API key, or token is hardcoded directly in the source code. If this code is committed to version control, the secret is permanently exposed and must be rotated.",
    suggestion: "Move secrets to environment variables (process.env.SECRET_NAME) and use a secrets manager. Never commit credentials to source control.",
  },
  {
    pattern: /password\s*[=:]\s*["'][^"']{2,}/i,
    category: "critical_security", severity: "critical",
    title: "Hardcoded Password",
    description: "A plaintext password is hardcoded in the source. This is a critical security vulnerability — any attacker with code access gains immediate credentials.",
    suggestion: "Store passwords in environment variables or a secrets vault. In production, use hashed passwords with bcrypt/argon2 and never compare plaintext.",
  },
  {
    pattern: /eval\s*\([^)]*(?:req\.|request\.|input|param|query|body)/i,
    category: "critical_security", severity: "critical",
    title: "Remote Code Execution via eval()",
    description: "User-controlled input is being passed directly to eval(). This allows an attacker to execute arbitrary code on the server, leading to complete system compromise.",
    suggestion: "Remove eval() entirely. Parse structured data with JSON.parse(), use allowlists for dynamic logic, or use a sandboxed expression evaluator.",
  },
  {
    pattern: /exec\s*\([^)]*(?:req\.|request\.|input|param|query|body|\$_GET|\$_POST)/i,
    category: "critical_security", severity: "critical",
    title: "Command Injection Risk",
    description: "User input is being passed to a shell execution function. An attacker can inject shell metacharacters to run arbitrary system commands.",
    suggestion: "Never pass user input to shell commands. Use parameterized APIs (child_process.execFile with args array), validate inputs strictly, and apply least-privilege principles.",
  },
  {
    pattern: /innerHTML\s*=\s*(?!["'`]<)/,
    category: "critical_security", severity: "high",
    title: "Cross-Site Scripting (XSS) via innerHTML",
    description: "Assigning to innerHTML with potentially unescaped content enables XSS attacks. An attacker can inject malicious scripts that execute in the victim's browser.",
    suggestion: "Use textContent instead of innerHTML, or sanitize input with DOMPurify before insertion. Consider using a templating library that auto-escapes output.",
  },
  {
    pattern: /\.query\s*\+|`[^`]*\$\{[^}]*(?:req\.|query\.|param)[^}]*\}[^`]*`/,
    category: "critical_security", severity: "critical",
    title: "SQL Injection Risk",
    description: "User-supplied data appears to be concatenated directly into a SQL query string. This allows attackers to manipulate queries, bypass authentication, and exfiltrate data.",
    suggestion: "Use parameterized queries or prepared statements exclusively. Never concatenate user input into SQL strings. Use an ORM with proper escaping.",
  },
  {
    pattern: /Math\.random\s*\(\s*\).*(?:token|session|key|secret|csrf|nonce|uuid)/i,
    category: "critical_security", severity: "high",
    title: "Weak Cryptographic Randomness",
    description: "Math.random() is not cryptographically secure and must not be used for security-sensitive values like tokens, session IDs, or nonces. Its output is predictable.",
    suggestion: "Use crypto.getRandomValues() in browsers or crypto.randomBytes() / crypto.randomUUID() in Node.js for all security-sensitive random values.",
  },
  {
    pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/i,
    category: "critical_security", severity: "high",
    title: "Insecure HTTP Connection",
    description: "Plain HTTP is used instead of HTTPS for an external connection. Data transmitted over HTTP is unencrypted and vulnerable to man-in-the-middle attacks.",
    suggestion: "Replace all http:// URLs with https:// for any external communication. Enforce HSTS headers on your server.",
  },
  {
    pattern: /console\.log\s*\([^)]*(?:password|secret|token|key|auth)/i,
    category: "critical_security", severity: "medium",
    title: "Sensitive Data in Console Logs",
    description: "Potentially sensitive data (password, token, secret, or key) is being logged to the console. This can leak credentials into log files and monitoring systems.",
    suggestion: "Remove all logging of sensitive data. Sanitize log entries and use structured logging with redaction for any PII or credentials.",
  },
  {
    pattern: /for\s*\([^)]+\)\s*\{[^}]*for\s*\([^)]+\)/,
    category: "performance", severity: "medium",
    title: "Nested Loop (O(n²) Complexity)",
    description: "A nested loop pattern was detected. Depending on input size, this can degrade to O(n²) or worse performance, causing slow execution on large datasets.",
    suggestion: "Consider using hash maps/sets for O(1) lookups, sorting algorithms where applicable, or restructuring the algorithm to reduce nested iterations.",
  },
  {
    pattern: /setInterval|setTimeout\([^,]+,\s*0\s*\)/,
    category: "performance", severity: "low",
    title: "Potential Event Loop Blocking",
    description: "Using setTimeout with 0ms delay or setInterval for synchronous-looking async code can create event loop stalls and unpredictable timing behavior.",
    suggestion: "Use Promise-based async/await patterns, requestAnimationFrame for UI work, or proper async queues instead of zero-delay timers.",
  },
  {
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
    category: "style", severity: "medium",
    title: "Empty Catch Block (Swallowed Error)",
    description: "An empty catch block silently discards exceptions. This makes debugging extremely difficult and can hide critical failures in production.",
    suggestion: "Always handle errors explicitly: log them with context, re-throw if unrecoverable, or return a meaningful error response to the caller.",
  },
  {
    pattern: /(?:var\s+\w+|function\s+\w+)\s*(?:=|:)/,
    category: "style", severity: "info",
    title: "Legacy Variable Declaration",
    description: "var declarations or old-style function expressions are present. They have function-scoped hoisting behavior that can cause subtle bugs.",
    suggestion: "Replace var with const (for values that don't change) or let (for reassigned values). Use arrow functions or named function declarations consistently.",
  },
  {
    pattern: /TODO|FIXME|HACK|XXX/,
    category: "style", severity: "info",
    title: "Unresolved TODO / Technical Debt Marker",
    description: "Source code contains TODO, FIXME, HACK, or XXX comments indicating known issues or incomplete work that was left unaddressed.",
    suggestion: "Convert TODO items into tracked issues in your project management tool. Resolve or document each one with an owner and deadline.",
  },
];

function runRuleBasedAnalysis(code: string): RuleFinding[] {
  const lines = code.split("\n");
  const findings: RuleFinding[] = [];
  const seenTitles = new Set<string>();

  for (const rule of SECURITY_RULES) {
    if (seenTitles.has(rule.title)) continue;

    // Check line by line to get accurate line numbers
    let matchLine: number | undefined;
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        matchLine = i + 1;
        break;
      }
    }

    // Also test the full code block for multi-line patterns
    const fullMatch = matchLine !== undefined || rule.pattern.test(code);
    if (!fullMatch) continue;

    seenTitles.add(rule.title);
    findings.push({
      id: `rule-${crypto.randomUUID().slice(0, 8)}`,
      category: rule.category,
      severity: rule.severity,
      title: rule.title,
      description: rule.description,
      line: matchLine,
      suggestion: rule.suggestion,
    });
  }

  return findings;
}

function computeRuleScore(findings: RuleFinding[]): number {
  let score = 100;
  for (const f of findings) {
    if (f.severity === "critical") score -= 25;
    else if (f.severity === "high") score -= 15;
    else if (f.severity === "medium") score -= 8;
    else if (f.severity === "low") score -= 3;
    else score -= 1;
  }
  return Math.max(0, Math.min(100, score));
}

// ─── JSON Extraction (handles markdown-fenced LLM output) ────────────────────

function extractJson(raw: string): string {
  // Strip ```json ... ``` or ``` ... ``` fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Find the outermost { ... }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1);
  return raw;
}

// ─── Analyze Handler ─────────────────────────────────────────────────────────

async function handleAnalyze(req: Parameters<Parameters<typeof router.post>[1]>[0], res: Parameters<Parameters<typeof router.post>[1]>[1]) {
  const parsed = AnalyzeCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
    return;
  }

  const { code, language, githubUrl } = parsed.data;
  let codeToAnalyze = code;

  if (githubUrl && !codeToAnalyze.trim()) {
    try {
      const rawUrl = githubUrl
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
      const response = await fetch(rawUrl);
      if (response.ok) codeToAnalyze = await response.text();
    } catch {
      req.log.warn("Failed to fetch GitHub URL");
    }
  }

  if (!codeToAnalyze.trim()) {
    res.status(400).json({ error: "No code provided" });
    return;
  }

  const detectedLanguage = detectLanguage(codeToAnalyze, language);

  const systemPrompt = `You are DevGuard QA, an expert senior DevSecOps engineer and code security auditor.
Analyze code for bugs, security vulnerabilities, and style issues.
Return ONLY valid JSON — NO markdown fences, NO explanation, just raw JSON:
{
  "findings": [
    {
      "id": "unique-id",
      "category": "critical_security" | "performance" | "style",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "title": "Short issue title",
      "description": "Detailed explanation of the issue",
      "line": <integer_or_null>,
      "suggestion": "Specific actionable fix"
    }
  ],
  "summary": "2-3 sentence executive summary",
  "score": <integer 0-100>
}

Categories:
- critical_security: SQL injection, XSS, hardcoded secrets, insecure crypto, auth bypass, RCE, SSRF, path traversal, unvalidated input
- performance: O(n²) loops, memory leaks, blocking calls, N+1 queries, unnecessary re-renders
- style: naming conventions, dead code, empty catch blocks, missing error handling, code duplication

Score: 100 = perfect. Deduct 20-30 for critical, 10-15 for high, 5-8 for medium. Be precise.`;

  let findings: RuleFinding[] = [];
  let summary = "";
  let score = 100;
  let usedFallback = false;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Language: ${detectedLanguage}\n\nAnalyze this code:\n\`\`\`${detectedLanguage}\n${codeToAnalyze.slice(0, 8000)}\n\`\`\``,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const json = extractJson(raw);
    const result = JSON.parse(json);

    findings = Array.isArray(result.findings) ? result.findings : [];
    summary = typeof result.summary === "string" ? result.summary : "";
    score = typeof result.score === "number" ? Math.max(0, Math.min(100, result.score)) : 100;

    // If LLM returned no findings, supplement with rule-based scan
    if (findings.length === 0) {
      const rulefindings = runRuleBasedAnalysis(codeToAnalyze);
      if (rulefindings.length > 0) {
        findings = rulefindings;
        score = computeRuleScore(rulefindings);
        usedFallback = true;
      }
    }
  } catch (err) {
    req.log.warn({ err }, "LLM analysis failed — falling back to rule-based engine");
    findings = runRuleBasedAnalysis(codeToAnalyze);
    score = computeRuleScore(findings);
    usedFallback = true;
  }

  if (!summary) {
    const critCount = findings.filter(f => f.category === "critical_security").length;
    const perfCount = findings.filter(f => f.category === "performance").length;
    const styleCount = findings.filter(f => f.category === "style").length;
    if (findings.length === 0) {
      summary = `No issues detected in the provided ${detectedLanguage} code. The code appears well-structured and follows security best practices.`;
    } else if (usedFallback) {
      summary = `Rule-based scan of ${detectedLanguage} code detected ${findings.length} issue${findings.length !== 1 ? "s" : ""}: ${critCount} security, ${perfCount} performance, ${styleCount} style. Review each finding carefully.`;
    } else {
      summary = `Analysis of ${detectedLanguage} code completed. Found ${findings.length} issue${findings.length !== 1 ? "s" : ""} across ${critCount} security, ${perfCount} performance, and ${styleCount} style categories.`;
    }
  }

  const criticalCount = findings.filter(f => f.category === "critical_security").length;
  const performanceCount = findings.filter(f => f.category === "performance").length;
  const styleCount = findings.filter(f => f.category === "style").length;
  const reviewId = crypto.randomUUID();

  try {
    await db.insert(reviewsTable).values({
      reviewId,
      language: detectedLanguage,
      code: codeToAnalyze.slice(0, 5000),
      score,
      summary,
      findings,
      criticalCount,
      performanceCount,
      styleCount,
    });
  } catch (dbErr) {
    req.log.warn({ dbErr }, "Failed to persist review — returning result anyway");
  }

  res.json({
    reviewId,
    language: detectedLanguage,
    findings,
    summary,
    score,
    criticalCount,
    performanceCount,
    styleCount,
    ...(usedFallback ? { analysisEngine: "rule-based" } : { analysisEngine: "ai" }),
  });
}

// ─── Autofix Handler ─────────────────────────────────────────────────────────

async function handleAutofix(req: Parameters<Parameters<typeof router.post>[1]>[0], res: Parameters<Parameters<typeof router.post>[1]>[1]) {
  const parsed = AutofixCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { code, findings, language } = parsed.data;

  const findingsList = findings
    .map(f => `- [${f.severity.toUpperCase()}] ${f.title}: ${f.suggestion}`)
    .join("\n");

  const systemPrompt = `You are DevGuard QA. Fix the provided code based on the listed findings.
Return ONLY raw JSON, NO markdown fences:
{
  "fixedCode": "<complete corrected code as a string>",
  "changesSummary": "Concise summary of all changes made",
  "issuesFixed": <integer>
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Language: ${language ?? "unknown"}\n\nFix these issues:\n${findingsList}\n\nOriginal code:\n\`\`\`\n${code}\n\`\`\``,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const json = extractJson(raw);
    const result = JSON.parse(json);

    res.json({
      fixedCode: result.fixedCode ?? code,
      changesSummary: result.changesSummary ?? "Applied fixes for detected issues.",
      issuesFixed: result.issuesFixed ?? findings.length,
    });
  } catch (err) {
    req.log.error({ err }, "Autofix failed");
    res.status(500).json({ error: "Autofix failed. Please try again." });
  }
}

// ─── Routes — both /review/analyze AND short alias /analyze ──────────────────

router.post("/analyze", handleAnalyze);
router.post("/autofix", handleAutofix);

router.get("/history", async (req, res) => {
  try {
    const reviews = await db
      .select()
      .from(reviewsTable)
      .orderBy(reviewsTable.createdAt)
      .limit(20);

    res.json(
      reviews.map(r => ({
        reviewId: r.reviewId,
        language: r.language,
        score: r.score,
        criticalCount: r.criticalCount,
        performanceCount: r.performanceCount,
        styleCount: r.styleCount,
        createdAt: r.createdAt.toISOString(),
        codeSnippet: r.code.slice(0, 100),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "History fetch failed");
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const reviews = await db.select().from(reviewsTable);
    const totalReviews = reviews.length;
    const criticalTotal = reviews.reduce((s, r) => s + r.criticalCount, 0);
    const performanceTotal = reviews.reduce((s, r) => s + r.performanceCount, 0);
    const styleTotal = reviews.reduce((s, r) => s + r.styleCount, 0);
    const totalFindings = criticalTotal + performanceTotal + styleTotal;
    const averageScore =
      totalReviews > 0
        ? Math.round(reviews.reduce((s, r) => s + r.score, 0) / totalReviews)
        : 0;

    res.json({
      totalReviews,
      totalFindings,
      criticalTotal,
      performanceTotal,
      styleTotal,
      averageScore,
      mostCommonIssue:
        criticalTotal >= performanceTotal && criticalTotal >= styleTotal
          ? "Security vulnerabilities"
          : performanceTotal >= styleTotal
          ? "Performance issues"
          : "Style violations",
    });
  } catch (err) {
    req.log.error({ err }, "Stats fetch failed");
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
