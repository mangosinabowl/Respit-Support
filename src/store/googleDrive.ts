import type { DomainEvent } from "../domain/events";
import type { RemoteStore } from "./sync";

/**
 * The app's own client id. Public by design: it is compiled into the page and
 * anyone can read it. The client secret that Google issues alongside it has no
 * role in a browser app and is deliberately not here.
 */
export const GOOGLE_CLIENT_ID = "1051566713700-rpskgfpp5ltim40l74a6to8lmdngmug7.apps.googleusercontent.com";

/**
 * appdata is a folder only this app can see. It cannot read the user's
 * documents or photos, and the sync files do not clutter their Drive.
 */
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

const fileNameFor = (deviceId: string) => `device-${deviceId}.json`;
const deviceIdFrom = (fileName: string) => fileName.replace(/^device-/, "").replace(/\.json$/, "");

declare global {
  interface Window { google?: any }
}

/** Loads Google's identity script once. */
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-gis]');
    if (existing) { existing.addEventListener("load", () => resolve()); return; }
    const el = document.createElement("script");
    el.src = "https://accounts.google.com/gsi/client";
    el.async = true;
    el.dataset.gis = "1";
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Could not reach Google to sign in. Check the connection."));
    document.head.appendChild(el);
  });
}

/**
 * Asks Google for an access token, showing the account chooser the first time.
 * Tokens are short-lived and kept only in memory - a new one is requested when
 * the old one expires, which is why this can be called freely.
 */
export async function connectDrive(interactive = true): Promise<string> {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      prompt: interactive ? "" : "none",
      callback: (res: any) => {
        if (res.error) reject(new Error(res.error_description || res.error));
        else resolve(res.access_token);
      },
      error_callback: (err: any) => reject(new Error(err?.message ?? "Sign-in was dismissed.")),
    });
    client.requestAccessToken();
  });
}

/**
 * A RemoteStore backed by the Drive appdata folder. One file per device, and
 * this device only ever writes its own, so any number of devices can sync
 * without overwriting each other.
 */
export function driveRemote(getToken: () => Promise<string>): RemoteStore {
  const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const token = await getToken();
    const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  };

  const findFile = async (deviceId: string): Promise<string | null> => {
    const q = encodeURIComponent(`name='${fileNameFor(deviceId)}'`);
    const res = await call(`${FILES}?spaces=appDataFolder&q=${q}&fields=files(id,name)`);
    const body = await res.json();
    return body.files?.[0]?.id ?? null;
  };

  return {
    async listDevices() {
      const res = await call(`${FILES}?spaces=appDataFolder&fields=files(id,name)&pageSize=1000`);
      const body = await res.json();
      return (body.files ?? [])
        .map((f: any) => f.name as string)
        .filter((n: string) => n.startsWith("device-") && n.endsWith(".json"))
        .map(deviceIdFrom);
    },

    async read(deviceId) {
      const id = await findFile(deviceId);
      if (!id) return [];
      const res = await call(`${FILES}/${id}?alt=media`);
      const body = await res.json();
      // A malformed or half-written file must not take the whole sync down.
      return Array.isArray(body?.events) ? (body.events as DomainEvent[]) : [];
    },

    async write(deviceId, events) {
      const id = await findFile(deviceId);
      const metadata = id ? {} : { name: fileNameFor(deviceId), parents: ["appDataFolder"] };
      const payload = JSON.stringify({ version: 1, kind: "respite-event-log", deviceId, updatedAt: new Date().toISOString(), events });
      const boundary = "respite-" + Math.random().toString(36).slice(2);
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`;
      await call(`${UPLOAD}${id ? `/${id}` : ""}?uploadType=multipart`, {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
    },
  };
}
