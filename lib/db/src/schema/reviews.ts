import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const FindingSchema = z.object({
  id: z.string(),
  category: z.enum(["critical_security", "performance", "style"]),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  title: z.string(),
  description: z.string(),
  line: z.number().optional(),
  suggestion: z.string(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const reviewsTable = pgTable("reviews", {
  id: serial("id").primaryKey(),
  reviewId: text("review_id").notNull().unique(),
  language: text("language").notNull().default("unknown"),
  code: text("code").notNull(),
  score: integer("score").notNull().default(100),
  summary: text("summary").notNull().default(""),
  findings: jsonb("findings").notNull().default([]),
  criticalCount: integer("critical_count").notNull().default(0),
  performanceCount: integer("performance_count").notNull().default(0),
  styleCount: integer("style_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReviewSchema = createInsertSchema(reviewsTable).omit({ id: true, createdAt: true });
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviewsTable.$inferSelect;
