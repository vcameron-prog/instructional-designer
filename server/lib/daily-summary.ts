import nodemailer from "nodemailer";
import cron from "node-cron";
import { db } from "../db";
import { users } from "../../shared/models/auth";
import { courses, generatedContent, conversions } from "../../shared/schema";
import { sql, gte, and, eq } from "drizzle-orm";

const SUMMARY_EMAIL_TO = process.env.SUMMARY_EMAIL_TO || "vcameron@bridgew.edu";
const SUMMARY_EMAIL_FROM = process.env.SUMMARY_EMAIL_FROM || "";
const SUMMARY_EMAIL_PASSWORD = process.env.SUMMARY_EMAIL_PASSWORD || "";
const SUMMARY_CRON = process.env.SUMMARY_CRON || "0 7 * * *";

interface DailySummaryStats {
  newUsers: Array<{ firstName: string | null; lastName: string | null; email: string | null; createdAt: Date | null }>;
  conversionsCompleted: number;
  conversionsFailed: number;
  failedConversions: Array<{ filename: string; error: string | null; createdAt: Date }>;
  contentGenerated: number;
  allTimeUsers: number;
  allTimeCourses: number;
  allTimeConversions: number;
}

async function fetchDailyStats(): Promise<DailySummaryStats> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [newUsers, conversionRows, contentRows, totals] = await Promise.all([
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
      .select({ count: sql<number>`count(*)` })
      .from(generatedContent)
      .where(gte(generatedContent.createdAt, since)),

    db
      .select({
        totalUsers: sql<number>`(select count(*) from users)`,
        totalCourses: sql<number>`(select count(*) from courses)`,
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
    contentGenerated: Number(contentRows[0]?.count ?? 0),
    allTimeUsers: Number(totals[0]?.totalUsers ?? 0),
    allTimeCourses: Number(totals[0]?.totalCourses ?? 0),
    allTimeConversions: Number(totals[0]?.totalConversions ?? 0),
  };
}

function buildEmailHtml(stats: DailySummaryStats, date: string): string {
  const hasActivity =
    stats.newUsers.length > 0 ||
    stats.conversionsCompleted > 0 ||
    stats.conversionsFailed > 0 ||
    stats.contentGenerated > 0;

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
            <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">BSU Instructional Design Tool</p>
            <p style="margin:6px 0 0;font-size:14px;color:#ffcccc;">Daily Summary — ${date}</p>
          </td>
        </tr>

        <!-- Status banner -->
        <tr>
          <td style="padding:16px 24px;border-bottom:1px solid #f0f0f0;background:${hasActivity ? "#f0fdf4" : "#fafafa"};">
            <p style="margin:0;font-size:15px;color:${hasActivity ? "#166534" : "#666"};">
              ${hasActivity ? "Activity recorded in the last 24 hours." : "Quiet day — no activity in the last 24 hours."}
            </p>
          </td>
        </tr>

        <!-- Last 24h stats grid -->
        <tr>
          <td style="padding:20px 24px 8px;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;">Last 24 Hours</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:33%;text-align:center;padding:12px;background:#f9f9f9;border-radius:6px;">
                  <p style="margin:0;font-size:28px;font-weight:700;color:#8b0000;">${stats.newUsers.length}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#666;">New users</p>
                </td>
                <td style="width:4px;"></td>
                <td style="width:33%;text-align:center;padding:12px;background:#f9f9f9;border-radius:6px;">
                  <p style="margin:0;font-size:28px;font-weight:700;color:#166534;">${stats.conversionsCompleted}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#666;">Docs converted</p>
                </td>
                <td style="width:4px;"></td>
                <td style="width:33%;text-align:center;padding:12px;background:#f9f9f9;border-radius:6px;">
                  <p style="margin:0;font-size:28px;font-weight:700;color:#1d4ed8;">${stats.contentGenerated}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#666;">AI content generated</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- New users detail -->
        ${newUsersSection}

        <!-- Failed conversions -->
        ${failedSection}

        <!-- All-time totals -->
        <tr>
          <td style="padding:20px 24px 8px;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;">All-Time Totals</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:33%;text-align:center;padding:10px;border:1px solid #e5e5e5;border-radius:6px;">
                  <p style="margin:0;font-size:22px;font-weight:700;color:#1a1a1a;">${stats.allTimeUsers}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#666;">Total users</p>
                </td>
                <td style="width:4px;"></td>
                <td style="width:33%;text-align:center;padding:10px;border:1px solid #e5e5e5;border-radius:6px;">
                  <p style="margin:0;font-size:22px;font-weight:700;color:#1a1a1a;">${stats.allTimeCourses}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#666;">Courses created</p>
                </td>
                <td style="width:4px;"></td>
                <td style="width:33%;text-align:center;padding:10px;border:1px solid #e5e5e5;border-radius:6px;">
                  <p style="margin:0;font-size:22px;font-weight:700;color:#1a1a1a;">${stats.allTimeConversions}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#666;">Documents converted</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 24px;border-top:1px solid #f0f0f0;text-align:center;">
            <p style="margin:0;font-size:12px;color:#999;">
              Sent automatically by the BSU Instructional Design Tool &bull;
              <a href="https://bsu-instructional-designer.replit.app/admin" style="color:#8b0000;">View admin dashboard</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendDailySummary(): Promise<void> {
  if (!SUMMARY_EMAIL_FROM || !SUMMARY_EMAIL_PASSWORD) {
    console.warn("[daily-summary] Skipping: SUMMARY_EMAIL_FROM or SUMMARY_EMAIL_PASSWORD not set.");
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
    from: `"BSU ID Tool" <${SUMMARY_EMAIL_FROM}>`,
    to: SUMMARY_EMAIL_TO,
    subject: `BSU ID Tool — Daily Summary ${date}`,
    html,
  });

  console.log(`[daily-summary] Summary email sent to ${SUMMARY_EMAIL_TO}`);
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
