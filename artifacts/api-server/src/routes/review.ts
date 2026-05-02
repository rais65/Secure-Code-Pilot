import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import { reviewsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AnalyzeCodeBody, AutofixCodeBody } from "@workspace/api-zod";
import crypto from "node:crypto";

const router = Router();

function detectLanguage(code: string, hint?: string): string {
  if (hint) return hint;
  if (code.includes("def ") && code.includes(":")) return "python";
  if (code.includes("fn ") && code.includes("->")) return "rust";
  if (code.includes("func ") && code.includes("go\n")) return "go";
  if (code.includes("<?php")) return "php";
  if (code.includes("class ") && code.includes("public static void main")) return "java";
  if (code.includes("using System") || code.includes("namespace ")) return "csharp";
  if (code.includes("const ") || code.includes("let ") || code.includes("var ") || code.includes("=>")) return "typescript";
  return "javascript";
}

router.post("/analyze", async (req, res) => {
  const parsed = AnalyzeCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { code, language, githubUrl } = parsed.data;
  let codeToAnalyze = code;

  if (githubUrl && !codeToAnalyze) {
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

  const detectedLanguage = detectLanguage(codeToAnalyze, language);

  const systemPrompt = `You are DevGuard QA, an expert senior DevSecOps engineer and code security auditor. 
Analyze code for bugs, security vulnerabilities, and style issues. 
Return ONLY valid JSON matching this exact structure, no markdown:
{
  "findings": [
    {
      "id": "unique-id",
      "category": "critical_security" | "performance" | "style",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "title": "Short issue title",
      "description": "Detailed explanation of the issue",
      "line": <line_number_or_null>,
      "suggestion": "Specific fix suggestion"
    }
  ],
  "summary": "2-3 sentence executive summary of the code quality",
  "score": <integer_0_to_100>
}

Categories:
- critical_security: SQL injection, XSS, hardcoded secrets, insecure crypto, auth bypass, RCE, SSRF, path traversal, unvalidated input
- performance: O(n²) loops, memory leaks, blocking calls, inefficient queries, unnecessary re-renders
- style: naming conventions, dead code, missing error handling, code duplication, poor documentation

Be thorough and precise. A score of 100 means perfect code. Deduct heavily for critical security issues.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Language: ${detectedLanguage}\n\nCode to analyze:\n\`\`\`${detectedLanguage}\n${codeToAnalyze}\n\`\`\`` },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    const result = JSON.parse(content);
    const findings = result.findings ?? [];
    const criticalCount = findings.filter((f: { category: string }) => f.category === "critical_security").length;
    const performanceCount = findings.filter((f: { category: string }) => f.category === "performance").length;
    const styleCount = findings.filter((f: { category: string }) => f.category === "style").length;
    const reviewId = crypto.randomUUID();
    const score = Math.max(0, Math.min(100, result.score ?? 100));

    await db.insert(reviewsTable).values({
      reviewId,
      language: detectedLanguage,
      code: codeToAnalyze.slice(0, 5000),
      score,
      summary: result.summary ?? "",
      findings,
      criticalCount,
      performanceCount,
      styleCount,
    });

    res.json({
      reviewId,
      language: detectedLanguage,
      findings,
      summary: result.summary ?? "",
      score,
      criticalCount,
      performanceCount,
      styleCount,
    });
  } catch (err) {
    req.log.error({ err }, "Analysis failed");
    res.status(500).json({ error: "Analysis failed" });
  }
});

router.post("/autofix", async (req, res) => {
  const parsed = AutofixCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { code, findings, language } = parsed.data;

  const findingsList = findings
    .map((f) => `- [${f.severity.toUpperCase()}] ${f.title}: ${f.suggestion}`)
    .join("\n");

  const systemPrompt = `You are DevGuard QA, an expert code security auditor. 
Fix the provided code based on the listed security findings and issues.
Return ONLY valid JSON with this structure, no markdown:
{
  "fixedCode": "<the complete fixed code as a string>",
  "changesSummary": "Brief description of all changes made",
  "issuesFixed": <number_of_issues_fixed>
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Language: ${language ?? "unknown"}\n\nIssues to fix:\n${findingsList}\n\nOriginal code:\n\`\`\`\n${code}\n\`\`\``,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    const result = JSON.parse(content);

    res.json({
      fixedCode: result.fixedCode ?? code,
      changesSummary: result.changesSummary ?? "No changes made",
      issuesFixed: result.issuesFixed ?? 0,
    });
  } catch (err) {
    req.log.error({ err }, "Autofix failed");
    res.status(500).json({ error: "Autofix failed" });
  }
});

router.get("/history", async (req, res) => {
  try {
    const reviews = await db
      .select()
      .from(reviewsTable)
      .orderBy(reviewsTable.createdAt)
      .limit(20);

    res.json(
      reviews.map((r) => ({
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
    const totalFindings = reviews.reduce(
      (sum, r) => sum + r.criticalCount + r.performanceCount + r.styleCount,
      0
    );
    const criticalTotal = reviews.reduce((sum, r) => sum + r.criticalCount, 0);
    const performanceTotal = reviews.reduce((sum, r) => sum + r.performanceCount, 0);
    const styleTotal = reviews.reduce((sum, r) => sum + r.styleCount, 0);
    const averageScore =
      totalReviews > 0
        ? Math.round(reviews.reduce((sum, r) => sum + r.score, 0) / totalReviews)
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
