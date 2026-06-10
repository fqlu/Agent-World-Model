import { google } from "googleapis";
import { q } from "./db";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function oauthClient() {
  if (!googleConfigured()) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in web/.env.local (see README).",
    );
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/google/callback",
  );
}

export function authUrl(): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });
}

export async function handleCallback(code: string): Promise<string> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();
  const email = me.data.email;
  if (!email) throw new Error("Could not determine account email from Google");
  q.saveTokens(email, tokens);
  return email;
}

export function driveFor(email: string) {
  const row = q.getTokens(email);
  if (!row) throw new Error(`No stored Google tokens for ${email} — connect the account first`);
  const client = oauthClient();
  client.setCredentials(JSON.parse(row.tokens));
  client.on("tokens", (t) => {
    const merged = { ...JSON.parse(q.getTokens(email)!.tokens), ...t };
    q.saveTokens(email, merged);
  });
  return google.drive({ version: "v3", auth: client });
}
