/**
 * Google Drive file store for the sync engine.
 *
 * Everything lives in the hidden `appDataFolder` of the user's own Drive. It is private to
 * this app (the `drive.appdata` scope cannot see any other file) and does not show up in the
 * normal Drive file list.
 */
import type { RemoteFile, RemoteProps, RemoteStore } from './engine';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,md5Checksum,modifiedTime,appProperties';

/** The user must sign in again (token missing, expired or revoked). */
export class AuthRequiredError extends Error {
  constructor(message = 'Please sign in to Google again.') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

/** Could not reach Google (offline, blocked, DNS ...). */
export class NetworkError extends Error {
  constructor(message = 'Cannot reach Google Drive. Check your internet connection.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class DriveError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

interface DriveFile {
  id: string;
  name: string;
  md5Checksum?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

const toRemote = (f: DriveFile): RemoteFile => ({
  id: f.id,
  name: f.name,
  version: f.md5Checksum || f.modifiedTime || '',
  modifiedTime: f.modifiedTime,
  deviceId: f.appProperties?.deviceId,
  deviceName: f.appProperties?.deviceName,
  lineage: f.appProperties?.lineage,
});

async function explain(res: Response): Promise<DriveError> {
  let reason = '';
  let message = '';
  try {
    const body = await res.json();
    reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
    message = body?.error?.message || '';
  } catch {
    /* not JSON */
  }
  if (reason === 'storageQuotaExceeded') return new DriveError('Your Google Drive is full. Free some space and try again.', res.status);
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || res.status === 429) {
    return new DriveError('Google Drive is busy. It will retry in a moment.', res.status);
  }
  if (res.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(`${reason} ${message}`)) {
    return new DriveError('The Google Drive API is not enabled for this app’s Google Cloud project.', res.status);
  }
  return new DriveError(message || `Google Drive error (${res.status}).`, res.status);
}

export type TokenProvider = (forceRefresh?: boolean) => Promise<string>;

export class DriveStore implements RemoteStore {
  constructor(
    private token: TokenProvider,
    private fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.token(false);
    let res: Response;
    try {
      res = await this.fetcher(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch {
      throw new NetworkError();
    }
    if (res.status === 401) {
      if (!retry) throw new AuthRequiredError();
      await this.token(true); // throws AuthRequiredError when it cannot refresh silently
      return this.call(url, init, false);
    }
    if (!res.ok) throw await explain(res);
    return res;
  }

  async list(): Promise<RemoteFile[]> {
    const out: RemoteFile[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        pageSize: '100',
        fields: `nextPageToken,files(${FIELDS})`,
        q: "trashed = false and name contains 'atombook-'",
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.call(`${API}/files?${params}`);
      const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
      for (const f of body.files ?? []) out.push(toRemote(f));
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  async read(file: RemoteFile): Promise<Uint8Array> {
    const res = await this.call(`${API}/files/${encodeURIComponent(file.id)}?alt=media`);
    return new Uint8Array(await res.arrayBuffer());
  }

  private multipart(metadata: object, body: Uint8Array): { blob: Blob; type: string } {
    const boundary = `atombook${Math.random().toString(16).slice(2)}${Date.now()}`;
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    return { blob: new Blob([head, body as BlobPart, tail]), type: `multipart/related; boundary=${boundary}` };
  }

  async create(name: string, body: Uint8Array, props: RemoteProps): Promise<RemoteFile> {
    const { blob, type } = this.multipart({ name, parents: ['appDataFolder'], appProperties: { ...props } }, body);
    const res = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: blob,
    });
    return toRemote((await res.json()) as DriveFile);
  }

  async update(id: string, body: Uint8Array, props: RemoteProps): Promise<RemoteFile> {
    const { blob, type } = this.multipart({ appProperties: { ...props } }, body);
    const res = await this.call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=${FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': type },
      body: blob,
    });
    return toRemote((await res.json()) as DriveFile);
  }

  async remove(id: string): Promise<void> {
    try {
      await this.call(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return; // already gone
      throw e;
    }
  }

  /** The signed-in account, for display only. Failure is harmless. */
  async account(): Promise<{ name: string; email: string } | null> {
    try {
      const res = await this.call(`${API}/about?fields=user(displayName,emailAddress)`);
      const u = ((await res.json()) as { user?: { displayName?: string; emailAddress?: string } }).user;
      return u ? { name: u.displayName ?? '', email: u.emailAddress ?? '' } : null;
    } catch {
      return null;
    }
  }
}
