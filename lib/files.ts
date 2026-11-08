/** Cross-platform "save a file": browser/Electron download, or Android share sheet. */

async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (await isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const data = await blobToBase64(blob);
    const written = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    await Share.share({ title: filename, url: written.uri, dialogTitle: 'Save or share' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const saveText = (text: string, filename: string, mime = 'text/plain') =>
  saveBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);

export const saveJson = (obj: unknown, filename: string) =>
  saveText(JSON.stringify(obj, null, 2), filename, 'application/json');
