import type { drive_v3 } from "googleapis";
import { Connector, Entry, assertSafeRelPath, parentPath, baseName } from "../connector";

const FOLDER = "application/vnd.google-apps.folder";

// Google Drive connector rooted at a folder ID. Paths are resolved segment by
// segment and cached for the lifetime of the connector instance.
export class GDriveConnector implements Connector {
  private idCache = new Map<string, string>(); // relPath -> fileId

  constructor(private drive: drive_v3.Drive, private rootId: string) {
    this.idCache.set("", rootId);
  }

  private async idFor(rel: string): Promise<string | null> {
    const safe = assertSafeRelPath(rel);
    if (this.idCache.has(safe)) return this.idCache.get(safe)!;
    const parts = safe.split("/").filter(Boolean);
    let parent = this.rootId;
    let pathSoFar = "";
    for (const part of parts) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      if (this.idCache.has(pathSoFar)) {
        parent = this.idCache.get(pathSoFar)!;
        continue;
      }
      const res = await this.drive.files.list({
        q: `'${parent}' in parents and name = '${part.replace(/'/g, "\\'")}' and trashed = false`,
        fields: "files(id)",
        pageSize: 2,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const id = res.data.files?.[0]?.id;
      if (!id) return null;
      this.idCache.set(pathSoFar, id);
      parent = id;
    }
    return parent;
  }

  async list(rel: string): Promise<Entry[]> {
    const id = await this.idFor(rel);
    if (!id) throw new Error(`Path not found in Drive: ${rel}`);
    const out: Entry[] = [];
    let pageToken: string | undefined;
    const prefix = assertSafeRelPath(rel);
    do {
      const res = await this.drive.files.list({
        q: `'${id}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, mimeType)",
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files ?? []) {
        const p = prefix ? `${prefix}/${f.name}` : f.name!;
        this.idCache.set(p, f.id!);
        out.push({
          name: f.name!,
          path: p,
          kind: f.mimeType === FOLDER ? "folder" : "file",
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(rel: string): Promise<string | null> {
    const id = await this.idFor(rel);
    if (!id) return null;
    try {
      const res = await this.drive.files.get(
        { fileId: id, alt: "media", supportsAllDrives: true },
        { responseType: "text" },
      );
      return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    } catch {
      return null; // binary / Google-native files are opaque to the linter
    }
  }

  async exists(rel: string): Promise<boolean> {
    return (await this.idFor(rel)) !== null;
  }

  async mkdir(rel: string): Promise<void> {
    const safe = assertSafeRelPath(rel);
    if (await this.idFor(safe)) return;
    const parent = parentPath(safe);
    if (parent && !(await this.idFor(parent))) await this.mkdir(parent);
    const parentId = (await this.idFor(parent))!;
    const res = await this.drive.files.create({
      requestBody: { name: baseName(safe), mimeType: FOLDER, parents: [parentId] },
      fields: "id",
      supportsAllDrives: true,
    });
    this.idCache.set(safe, res.data.id!);
  }

  async write(rel: string, content: string, opts?: { overwrite?: boolean }): Promise<void> {
    const safe = assertSafeRelPath(rel);
    const existing = await this.idFor(safe);
    if (existing && !opts?.overwrite) {
      throw new Error(`Refusing to overwrite existing file: ${rel}`);
    }
    if (existing) {
      await this.drive.files.update({
        fileId: existing,
        media: { mimeType: "text/markdown", body: content },
        supportsAllDrives: true,
      });
      return;
    }
    const parent = parentPath(safe);
    if (parent && !(await this.idFor(parent))) await this.mkdir(parent);
    const parentId = (await this.idFor(parent))!;
    const res = await this.drive.files.create({
      requestBody: { name: baseName(safe), parents: [parentId] },
      media: { mimeType: "text/markdown", body: content },
      fields: "id",
      supportsAllDrives: true,
    });
    this.idCache.set(safe, res.data.id!);
  }

  async move(from: string, to: string): Promise<void> {
    const fromId = await this.idFor(from);
    if (!fromId) throw new Error(`Path not found in Drive: ${from}`);
    if (await this.idFor(to)) throw new Error(`Refusing to move onto existing path: ${to}`);
    const toParent = parentPath(assertSafeRelPath(to));
    if (toParent && !(await this.idFor(toParent))) await this.mkdir(toParent);
    const newParentId = (await this.idFor(toParent))!;
    const oldParent = parentPath(assertSafeRelPath(from));
    const oldParentId = (await this.idFor(oldParent))!;
    await this.drive.files.update({
      fileId: fromId,
      requestBody: { name: baseName(to) },
      addParents: newParentId,
      removeParents: oldParentId,
      supportsAllDrives: true,
    });
    this.idCache.delete(assertSafeRelPath(from));
    this.idCache.set(assertSafeRelPath(to), fromId);
  }
}
