import nodemailer from "nodemailer";
import cron from "node-cron";
import { db } from "../db";
import { users } from "../../shared/models/auth";
import { conversions } from "../../shared/schema";
import { sql, gte } from "drizzle-orm";

const SUMMARY_EMAIL_TO = process.env.SUMMARY_EMAIL_TO || "vcameron@bridgew.edu";
const SUMMARY_EMAIL_FROM = process.env.SUMMARY_EMAIL_FROM || "";
const SUMMARY_EMAIL_PASSWORD = process.env.SUMMARY_EMAIL_PASSWORD || "";
const SUMMARY_CRON = process.env.SUMMARY_CRON || "0 7 * * *";

interface DailySummaryStats {
  newUsers: Array<{ firstName: string | null; lastName: string | null; email: string | null; createdAt: Date | null }>;
  conversionsCompleted: number;
  conversionsFailed: number;
  failedConversions: Array<{ filename: string; error: string | null; createdAt: Date }>;
  allTimeUsers: number;
  allTimeConversions: number;
}

async function fetchDailyStats(): Promise<DailySummaryStats> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [newUsers, conversionRows, totals] = await Promise.all([
    db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(gte(users.createdAt, since)),

    db
      .select({
        status: conversions.status,
        originalFilename: conversions.originalFilename,
        errorMessage: conversions.errorMessage,
        createdAt: conversions.createdAt,
      })
      .from(conversions)
      .where(gte(conversions.createdAt, since)),

    db
      .select({
        totalUsers: sql<number>`(select count(*) from users)`,
        totalConversions: sql<number>`(select count(*) from conversions)`,
      })
      .from(users)
      .limit(1),
  ]);

  const completed = conversionRows.filter((r) => r.status === "completed");
  const failed = conversionRows.filter((r) => r.status === "failed");

  return {
    newUsers,
    conversionsCompleted: completed.length,
    conversionsFailed: failed.length,
    failedConversions: failed.map((r) => ({
      filename: r.originalFilename,
      error: r.errorMessage,
      createdAt: r.createdAt,
    })),
    allTimeUsers: Number(totals[0]?.totalUsers ?? 0),
    allTimeConversions: Number(totals[0]?.totalConversions ?? 0),
  };
}

function buildEmailHtml(stats: DailySummaryStats, date: string): string {
  const hasActivity =
    stats.newUsers.length > 0 ||
    stats.conversionsCompleted > 0 ||
    stats.conversionsFailed > 0;

  const newUsersSection =
    stats.newUsers.length > 0
      ? `
    <tr>
      <td style="padding:16px 24px;border-bottom:1px solid #f0f0f0;">
        <p style="margin:0 0 8px;font-weight:600;color:#1a1a1a;">New sign-ups (${stats.newUsers.length})</p>
        <ul style="margin:0;padding-left:20px;color:#444;">
          ${stats.newUsers
            .map(
              (u) =>
                `<li>${u.firstName || ""} ${u.lastName || ""}${u.email ? ` &lt;${u.email}&gt;` : ""}</li>`,
            )
            .join("")}
        </ul>
      </td>
    </tr>`
      : `
    <tr>
      <td style="padding:16px 24px;border-bottom:1px solid #f0f0f0;color:#666;">
        No new sign-ups in the last 24 hours.
      </td>
    </tr>`;

  const failedSection =
    stats.conversionsFailed > 0
      ? `
    <tr>
      <td style="padding:16px 24px;border-bottom:1px solid #f0f0f0;background:#fff8f8;">
        <p style="margin:0 0 8px;font-weight:600;color:#c0392b;">Failed conversions (${stats.conversionsFailed})</p>
        <ul style="margin:0;padding-left:20px;color:#444;">
          ${stats.failedConversions
            .map(
              (f) =>
                `<li><strong>${f.filename}</strong>${f.error ? `: ${f.error.slice(0, 200)}` : ""}</li>`,
            )
            .join("")}
        </ul>
      </td>
    </tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

        <!-- Header -->
        <tr>
          <td style="background:#8b0000;padding:24px 24px 20px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">BSU Accessibility Converter</h1>
            <p style="margin:6px 0 0;color:#f5c6c6;font-size:13px;">Daily Summary — ${date}</p>
          </td>
        </tr>

        ${!hasActivity ? `
        <tr>
          <td style="padding:32px 24px;text-align:center;color:#666;">
            No activity in the last 24 hours.
          </td>
        </tr>` : ""}

        <!-- Stats row -->
        ${hasActivity ? `
        <tr>
          <td style="padding:16px 24px;border-bottom:1px solid #f0f0f0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="text-align:center;padding:8px;">
                  <p style="margin:0;font-size:28px;font-weight:700;color:#9e1b32;">${stats.conversionsCompleted}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.5px;">Conversions</p>
                </td>
                <td style="text-align:center;padding:8px;">
                  <p style="margin:0;font-size:28px;font-weight:700;color:#9e1b32;">${stats.newUsers.length}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.5px;">New Users</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ""}

        ${newUsersSection}
        ${failedSection}

        <!-- Footer totals -->
        <tr>
          <td style="padding:16px 24px;background:#fafafa;border-top:1px solid #eee;">
            <p style="margin:0;font-size:12px;color:#888;">
              All-time totals &mdash; Users: <strong>${stats.allTimeUsers}</strong> &nbsp;|&nbsp; Conversions: <strong>${stats.allTimeConversions}</strong>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendDailySummary(): Promise<void> {
  if (!SUMMARY_EMAIL_FROM || !SUMMARY_EMAIL_PASSWORD) {
    console.log("[daily-summary] Email credentials not configured — skipping.");
    return;
  }

  const stats = await fetchDailyStats();
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });

  const html = buildEmailHtml(stats, date);

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: SUMMARY_EMAIL_FROM,
      pass: SUMMARY_EMAIL_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"BSU Accessibility Converter" <${SUMMARY_EMAIL_FROM}>`,
    to: SUMMARY_EMAIL_TO,
    subject: `BSU Accessibility Converter — Daily Summary ${date}`,
    html,
  });

  console.log(`[daily-summary] Summary email sent to ${SUMMARY_EMAIL_TO}`);
}

/**
 * Notify an authenticated user that their conversion has finished.
 * Fire-and-forget: caller should .catch(() => {}) this.
 */
export async function sendConversionCompleteEmail(
  toEmail: string,
  firstName: string | null,
  filename: string,
  pageCount: number,
  score: number | null,
): Promise<void> {
  if (!SUMMARY_EMAIL_FROM || !SUMMARY_EMAIL_PASSWORD) return;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: SUMMARY_EMAIL_FROM, pass: SUMMARY_EMAIL_PASSWORD },
  });

  const name = firstName ?? "there";
  const REPLIT_DEV_DOMAIN = process.env.REPLIT_DEV_DOMAIN;
  const appUrl = process.env.APP_URL ||
    (REPLIT_DEV_DOMAIN ? `https://${REPLIT_DEV_DOMAIN}` : "");
  const scoreHtml = score !== null
    ? `<p style="margin:0 0 12px">Compliance score: <strong style="color:${score >= 90 ? "#16a34a" : score >= 70 ? "#d97706" : "#dc2626"}">${score}%</strong></p>`
    : "";

  await transporter.sendMail({
    from: `"Accessibility Tool" <${SUMMARY_EMAIL_FROM}>`,
    to: toEmail,
    subject: `Document ready: ${filename}`,
    html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
<h2 style="margin:0 0 16px;color:#9e1b32">Your document is ready</h2>
<p style="margin:0 0 12px">Hi ${name},</p>
<p style="margin:0 0 12px">Your ${pageCount}-page document <strong>${filename}</strong> has been converted to an accessible HTML format.</p>
${scoreHtml}
<p style="margin:0 0 20px">Review the output, apply any suggested fixes, then download as Word (.docx), HTML, or PDF.</p>
<a href="${appUrl}/pdf-accessibility" style="display:inline-block;padding:10px 20px;background:#9e1b32;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">View Document</a>
<p style="margin:24px 0 0;font-size:12px;color:#888">Accessibility Converter &mdash; Bridgewater State University</p>
</body></html>`,
  });
}

export function scheduleDailySummary(): void {
  if (!SUMMARY_EMAIL_FROM || !SUMMARY_EMAIL_PASSWORD) {
    console.log("[daily-summary] Email credentials not configured — daily summary disabled. Set SUMMARY_EMAIL_FROM and SUMMARY_EMAIL_PASSWORD to enable.");
    return;
  }

  if (!cron.validate(SUMMARY_CRON)) {
    console.warn(`[daily-summary] Invalid cron expression "${SUMMARY_CRON}" — using default "0 7 * * *"`);
  }

  const expression = cron.validate(SUMMARY_CRON) ? SUMMARY_CRON : "0 7 * * *";

  cron.schedule(
    expression,
    async () => {
      console.log("[daily-summary] Running scheduled daily summary...");
      try {
        await sendDailySummary();
      } catch (err) {
        console.error("[daily-summary] Failed to send summary email:", err);
      }
    },
    { timezone: "America/New_York" },
  );

  console.log(`[daily-summary] Scheduled daily summary at "${expression}" (America/New_York) → ${SUMMARY_EMAIL_TO}`);
}
