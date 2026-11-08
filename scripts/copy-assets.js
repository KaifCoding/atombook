// Copies the pdf.js worker into public/ so the app can render PDF previews fully offline.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs');
const dst = path.join(__dirname, '..', 'public', 'pdf.worker.min.mjs');
fs.copyFileSync(src, dst);
console.log('copied pdf.worker.min.mjs');
