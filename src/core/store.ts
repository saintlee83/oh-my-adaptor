import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session } from './types.js';

export class SessionStore {
  private pending = new Map<string, Promise<void>>();
  constructor(readonly directory: string) {}

  async load(): Promise<Session[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const sessions: Session[] = [];
    for (const file of await readdir(this.directory)) {
      if (!/^[a-f0-9-]+\.json$/.test(file)) continue;
      try {
        const value = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as Session;
        if (
          value.id + '.json' === file &&
          Array.isArray(value.events) &&
          typeof value.prompt === 'string'
        )
          sessions.push(value);
      } catch (error) {
        // Preserve damaged files for recovery; one damaged record must not hide other runs.
        console.error(
          `Could not read session ${file}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return sessions;
  }

  save(session: Session): Promise<void> {
    const payload = JSON.stringify(session);
    const previous = this.pending.get(session.id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const target = join(this.directory, `${session.id}.json`);
        await writeFile(`${target}.tmp`, payload, { mode: 0o600 });
        await rename(`${target}.tmp`, target);
      });
    this.pending.set(session.id, next);
    void next
      .finally(() => {
        if (this.pending.get(session.id) === next) this.pending.delete(session.id);
      })
      .catch(() => {});
    return next;
  }

  async delete(id: string): Promise<void> {
    await this.pending.get(id);
    await rm(join(this.directory, `${id}.json`), { force: true });
  }
}
