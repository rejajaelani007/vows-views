import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';

const source = await readFile(new URL('../src/upload-image.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'upload-image.ts', { loader: 'ts' });
const { prepareUpload, MAX_UPLOAD_BYTES } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

test('small photos retain their original bytes and MIME', async () => {
  const source = new Blob(['photo'], { type: 'image/png' });
  assert.equal(await prepareUpload(source), source);
});

test('oversized photos are encoded below the upload limit and release object URLs on success/error', async () => {
  const oldImage = globalThis.Image;
  const oldDocument = globalThis.document;
  const oldCreate = URL.createObjectURL,
    oldRevoke = URL.revokeObjectURL;
  let released = 0,
    attempts = 0,
    fail = false;
  globalThis.Image = class {
    naturalWidth = 4096;
    naturalHeight = 3072;
    async decode() {
      if (fail) throw new Error('Invalid image');
    }
  };
  globalThis.document = {
    createElement() {
      return {
        getContext: () => ({ fillRect() {}, drawImage() {} }),
        toBlob(done, type) {
          attempts++;
          done(new Blob([new Uint8Array(attempts === 1 ? MAX_UPLOAD_BYTES + 1 : 1024)], { type }));
        },
      };
    },
  };
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {
    released++;
  };
  try {
    const photo = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: 'image/png' });
    const encoded = await prepareUpload(photo);
    assert.ok(encoded.size <= MAX_UPLOAD_BYTES);
    assert.equal(encoded.type, 'image/jpeg');
    assert.equal(released, 1);
    fail = true;
    await assert.rejects(prepareUpload(photo), /Invalid image/);
    assert.equal(released, 2);
  } finally {
    if (oldImage === undefined) delete globalThis.Image;
    else globalThis.Image = oldImage;
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
  }
});
