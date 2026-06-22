import { db } from "./db";
import { eq, count, gte } from "drizzle-orm";
import {
  conversions,
  aiFixRetryEvents,
} from "@shared/schema";

export interface IStorage {
  // Manual Fix Items (per conversion)
  getManualFixItems(id: number): Promise<{ title: string; reason: string }[] | null>;
  setManualFixItems(id: number, items: { title: string; reason: string }[]): Promise<void>;

  // AI Fix Retry Events
  logAiFixRetryEvent(criterion?: string, title?: string): Promise<void>;
  getAiFixRetryStats(): Promise<{ lifetimeCount: number; thisMonthCount: number }>;
}

export class DatabaseStorage implements IStorage {
  // Manual Fix Items (per conversion)
  async getManualFixItems(id: number): Promise<{ title: string; reason: string }[] | null> {
    const [row] = await db.select({ manualFixItems: conversions.manualFixItems }).from(conversions).where(eq(conversions.id, id));
    if (!row) return null;
    const items = row.manualFixItems;
    if (!Array.isArray(items)) return null;
    return items as { title: string; reason: string }[];
  }

  async setManualFixItems(id: number, items: { title: string; reason: string }[]): Promise<void> {
    await db.update(conversions).set({ manualFixItems: items.length > 0 ? items : null }).where(eq(conversions.id, id));
  }

  // AI Fix Retry Events
  async logAiFixRetryEvent(criterion?: string, title?: string): Promise<void> {
    await db.insert(aiFixRetryEvents).values({ criterion: criterion ?? null, title: title ?? null });
  }

  async getAiFixRetryStats(): Promise<{ lifetimeCount: number; thisMonthCount: number }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [lifetimeRow] = await db.select({ value: count() }).from(aiFixRetryEvents);
    const [monthRow] = await db.select({ value: count() }).from(aiFixRetryEvents)
      .where(gte(aiFixRetryEvents.createdAt, startOfMonth));

    return {
      lifetimeCount: Number(lifetimeRow?.value ?? 0),
      thisMonthCount: Number(monthRow?.value ?? 0),
    };
  }
}

export const storage = new DatabaseStorage();
