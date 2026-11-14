import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('gallery and viewer render messages below photos as escaped text, with no empty captions', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { PhotoGrid, PhotoViewer } = await server.ssrLoadModule('/src/guest.tsx');
    const photo = {
      id: 'fixture',
      url: '/media/fixture',
      thumbnail: '/media/fixture/thumb',
      created_at: '2026-11-14T00:00:00Z',
      width: 640,
      height: 800,
      message: 'Selamat! 💕\n<script>alert("hello")</script>',
    };
    const html = renderToStaticMarkup(
      createElement(PhotoGrid, {
        photos: [photo, { ...photo, id: 'without-message', message: '' }],
        onSelect() {},
      }),
    );
    assert.equal((html.match(/<figcaption/g) || []).length, 1);
    assert.ok(html.indexOf('<img') < html.indexOf('<figcaption'));
    assert.ok(html.indexOf('</button>') < html.indexOf('<figcaption'));
    assert.ok(html.includes('Selamat! 💕\n&lt;script&gt;'));
    assert.doesNotMatch(html, /<script>/);
    const viewer = renderToStaticMarkup(createElement(PhotoViewer, { photo, onClose() {} }));
    assert.ok(viewer.indexOf('lightbox-image') < viewer.indexOf('lightbox-message'));
    assert.ok(viewer.includes('&lt;script&gt;'));
    assert.doesNotMatch(viewer, /<script>/);
    const long = 'a'.repeat(500);
    const fullCaption = renderToStaticMarkup(
      createElement(PhotoGrid, {
        photos: [{ ...photo, message: long }],
        onSelect() {},
      }),
    );
    assert.ok(fullCaption.includes(long));
  } finally {
    await server.close();
  }
});
