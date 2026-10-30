import { useEffect, useRef, useState } from 'react';
import { Modal, Btn } from './ui';

/**
 * Optional camera scanning using the browser/WebView's NATIVE BarcodeDetector
 * (Chromium-based, incl. WebView2 on supported Windows builds). If the device
 * or runtime does not support it, we say so plainly instead of pretending.
 * USB wedge scanners remain the primary, always-supported input method.
 */
export function CameraScan({ onScan, close }: { onScan: (code: string) => void; close: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = videoRef.current; if (!v) return;
        v.srcObject = stream; await v.play();
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix', 'itf'],
        });
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes?.length && codes[0].rawValue) { onScan(String(codes[0].rawValue)); close(); return; }
          } catch { /* frame not ready yet */ }
          timer = window.setTimeout(tick, 180);
        };
        void tick();
      } catch {
        setError('Camera could not be opened. Check Windows camera permissions (Settings → Privacy → Camera) or use the USB scanner.');
      }
    })();
    return () => { stopped = true; if (timer) clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  return (
    <Modal title="📷 Camera scan" onClose={close}>
      {!supported ? (
        <div className="text-sm text-slate-600 dark:text-slate-300 space-y-3">
          <p>Camera barcode detection is <b>not supported</b> in this browser/runtime (it needs the native <code>BarcodeDetector</code> API).</p>
          <p>No problem — a USB barcode/QR scanner works as a keyboard and is fully supported. Connect it and scan into the POS barcode box. See <b>Settings → Barcode &amp; Scanner → Test scanner</b> and <code>docs/SCANNER_SETUP.md</code>.</p>
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <>
          <video ref={videoRef} className="w-full rounded-xl bg-black aspect-video" muted playsInline />
          <p className="text-sm text-slate-500 mt-2 text-center">Hold the barcode / QR / DataMatrix steady in front of the camera…</p>
        </>
      )}
      <div className="flex justify-end mt-4"><Btn kind="ghost" onClick={close}>Cancel</Btn></div>
    </Modal>
  );
}
