/**
 * Transactional email. Production: Resend (RESEND_API_KEY + EMAIL_FROM). Development without a
 * key: the sign-in link is returned so the login page can show it (never in production).
 */
export interface SendResult { sent: boolean; devLink?: string }

export async function sendSignInEmail(to: string, link: string): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("Email is not configured (RESEND_API_KEY)");
    return { sent: false, devLink: link };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "KLIPD <hello@klipd.app>",
      to,
      subject: "Your KLIPD sign-in link",
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px"><h1 style="font-size:28px;margin:0 0 8px">KLIPD</h1><p style="color:#444">Tap the button to sign in. It works once and expires in 15 minutes.</p><p><a href="${link}" style="display:inline-block;background:#c8ff3d;color:#0a0f00;font-weight:700;padding:14px 24px;border-radius:999px;text-decoration:none">Sign in to KLIPD</a></p><p style="color:#888;font-size:12px">If you did not ask for this, ignore this email.</p></div>`,
      text: `Sign in to KLIPD: ${link}\n\nThis link works once and expires in 15 minutes.`,
    }),
  });
  if (!res.ok) throw new Error(`Email send failed (${res.status})`);
  return { sent: true };
}
