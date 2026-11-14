import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, readFile, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const safeName = (name) => /^[\da-f-]+(?:-thumb)?\.jpg$/i.test(name);
function blobUrl(name) {
  const url = new URL(name);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.public.blob.vercel-storage.com'))
    throw new Error('Invalid public Blob URL.');
  return url;
}

export async function createStorage({
  dataDir,
  provider = process.env.STORAGE_PROVIDER || 'local',
  token = process.env.BLOB_READ_WRITE_TOKEN,
  serverless = process.env.VERCEL === '1',
  sdk,
} = {}) {
  provider = provider.trim();
  token = token?.trim();
  if (provider === 'vercel-blob') {
    if (!token) throw new Error('Isi BLOB_READ_WRITE_TOKEN dari public Vercel Blob store.');
    const { put, del } = sdk || (await import('@vercel/blob'));
    return {
      provider,
      async write(name, data) {
        if (!safeName(name)) throw new Error('Invalid photo filename.');
        const result = await put(`photos/${name}`, data, {
          access: 'public',
          token,
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'image/jpeg',
          cacheControlMaxAge: 60,
        });
        blobUrl(result.url);
        return result.url;
      },
      async remove(name) {
        const path = safeName(name) ? `photos/${name}` : blobUrl(name).href;
        await del(path, { token });
      },
      async read(name) {
        const response = await fetch(blobUrl(name), { redirect: 'error' });
        if (!response.ok) throw Error('Photo storage unavailable');
        return Buffer.from(await response.arrayBuffer());
      },
      async sendScoped(res, name, download) {
        const response = await fetch(blobUrl(name), { redirect: 'error' });
        if (!response.ok || !response.body) throw Error('Photo storage unavailable');
        if (download) res.attachment('wedding.jpg');
        await pipeline(Readable.fromWeb(response.body), res);
      },
      send(res, name, download) {
        const url = blobUrl(name);
        if (download) url.searchParams.set('download', '1');
        res.removeHeader('Content-Type');
        res.set('Cache-Control', 'no-store');
        return res.redirect(302, url.href);
      },
    };
  }
  if (provider !== 'local') throw new Error('STORAGE_PROVIDER harus local atau vercel-blob.');
  if (serverless) throw new Error('Vercel memerlukan STORAGE_PROVIDER=vercel-blob.');
  const directory = resolve(dataDir, 'photos');
  await mkdir(directory, { recursive: true });
  function path(name) {
    if (!safeName(name)) throw new Error('Invalid photo filename.');
    return resolve(directory, name);
  }
  return {
    provider,
    async write(name, data) {
      await writeFile(path(name), data, { flag: 'wx' });
      return name;
    },
    read: (name) => readFile(path(name)),
    remove: (name) => unlink(path(name)),
    send(res, name, download) {
      if (download) res.attachment(name);
      return res.sendFile(path(name));
    },
    async recover(referenced) {
      for (const name of await readdir(directory)) {
        if (
          safeName(name) &&
          !referenced.has(name) &&
          (await stat(path(name))).mtimeMs < Date.now() - 3600000
        )
          await unlink(path(name)).catch(() => {});
      }
    },
  };
}
