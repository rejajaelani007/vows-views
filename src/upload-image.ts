// Stay below Vercel's 4.5 MB multipart payload limit, including form overhead.
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export async function prepareUpload(blob: Blob): Promise<Blob> {
  if (blob.size <= MAX_UPLOAD_BYTES) return blob;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 50000000
    )
      throw new Error('Resolusi foto terlalu besar. Pilih foto di bawah 50 megapiksel.');
    const canvas = document.createElement('canvas');
    let longest = Math.min(4096, Math.max(image.naturalWidth, image.naturalHeight));
    while (longest >= 640) {
      const scale = Math.min(1, longest / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Browser tidak dapat memproses foto.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.8, 0.7]) {
        const encoded = await new Promise<Blob | null>((done) =>
          canvas.toBlob(done, 'image/jpeg', quality),
        );
        if (!encoded) throw new Error('Foto gagal dikompres. Coba foto lain.');
        if (encoded.size <= MAX_UPLOAD_BYTES) return encoded;
      }
      longest = Math.floor(longest * 0.75);
    }
    throw new Error('Foto masih terlalu besar. Pilih foto dengan resolusi lebih kecil.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
