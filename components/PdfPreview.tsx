'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Renders a PDF blob to canvases with pdf.js. Unlike an <iframe>/<embed>, this works
 * inside Android WebView and Electron alike, and needs no network (worker is bundled in /public).
 */
export function PdfPreview({ blob, className = '' }: { blob: Blob | null; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const el = host.current;
    if (!blob || !el) return;
    (async () => {
      setBusy(true);
      setError('');
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const data = new Uint8Array(await blob.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        const pages: HTMLCanvasElement[] = [];
        const cssWidth = Math.max(280, el.clientWidth);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = (cssWidth / base.width) * dpr;
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = '100%';
          canvas.style.display = 'block';
          canvas.style.marginBottom = '12px';
          canvas.style.background = '#fff';
          canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,.2)';
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
          pages.push(canvas);
          if (cancelled) return;
        }
        if (!cancelled) el.replaceChildren(...pages);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Could not render the preview');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  return (
    <div className={className}>
      {busy && <div className="mb-2 text-xs text-gray-500">Updating preview…</div>}
      {error && <div className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <div ref={host} />
    </div>
  );
}
