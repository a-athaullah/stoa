const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function compress(filePath, { maxDim = 1920, quality = 75 } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return Promise.resolve({ skipped: true, reason: 'not an image', path: filePath });

  const originalSize = fs.statSync(filePath).size;
  if (originalSize < 200 * 1024) return Promise.resolve({ skipped: true, reason: 'already small', path: filePath, originalSize });

  const outPath = filePath.replace(/\.[^.]+$/, '.jpg');

  if (os.platform() === 'win32') return compressWindows(filePath, outPath, maxDim, quality, originalSize);
  return compressLinux(filePath, outPath, maxDim, quality, originalSize);
}

function compressWindows(inputPath, outPath, maxDim, quality, originalSize) {
  const absIn = path.resolve(inputPath).replace(/\//g, '\\');
  const absOut = path.resolve(outPath).replace(/\//g, '\\');

  const script = `
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('${absIn}')
$w = $img.Width; $h = $img.Height
if ($w -gt ${maxDim} -or $h -gt ${maxDim}) {
  $ratio = [Math]::Min(${maxDim} / $w, ${maxDim} / $h)
  $nw = [int]($w * $ratio); $nh = [int]($h * $ratio)
} else { $nw = $w; $nh = $h }
$bmp = New-Object System.Drawing.Bitmap($nw, $nh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = 'HighQualityBicubic'
$g.SmoothingMode = 'HighQuality'
$g.DrawImage($img, 0, 0, $nw, $nh)
$g.Dispose(); $img.Dispose()
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${quality})
$bmp.Save('${absOut}', $codec, $params)
$bmp.Dispose()
Write-Output "OK"
`.trim();

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      if (!fs.existsSync(absOut)) return reject(new Error('output file not created'));

      const compressedSize = fs.statSync(absOut).size;

      if (absIn !== absOut && compressedSize < originalSize) {
        try { fs.unlinkSync(absIn); } catch {}
      } else if (compressedSize >= originalSize) {
        try { fs.unlinkSync(absOut); } catch {}
        return resolve({ skipped: true, reason: 'compressed larger than original', path: inputPath, originalSize });
      }

      resolve({ success: true, path: absOut, originalSize, compressedSize, ratio: ((1 - compressedSize / originalSize) * 100).toFixed(1) + '%' });
    });
  });
}

function compressLinux(inputPath, outPath, maxDim, quality, originalSize) {
  return new Promise((resolve, reject) => {
    execFile('convert', [inputPath, '-resize', `${maxDim}x${maxDim}>`, '-quality', String(quality), outPath], { timeout: 30000 }, (err) => {
      if (!err && fs.existsSync(outPath)) {
        const compressedSize = fs.statSync(outPath).size;
        if (compressedSize >= originalSize) {
          try { fs.unlinkSync(outPath); } catch {}
          return resolve({ skipped: true, reason: 'compressed larger than original', path: inputPath, originalSize });
        }
        if (inputPath !== outPath) try { fs.unlinkSync(inputPath); } catch {}
        return resolve({ success: true, path: outPath, originalSize, compressedSize, ratio: ((1 - compressedSize / originalSize) * 100).toFixed(1) + '%' });
      }

      execFile('python3', ['-c', `
import sys
from PIL import Image
img = Image.open('${inputPath}')
w, h = img.size
if w > ${maxDim} or h > ${maxDim}:
    r = min(${maxDim}/w, ${maxDim}/h)
    img = img.resize((int(w*r), int(h*r)), Image.LANCZOS)
img.convert('RGB').save('${outPath}', 'JPEG', quality=${quality})
print('OK')
`], { timeout: 30000 }, (err2) => {
        if (!err2 && fs.existsSync(outPath)) {
          const compressedSize = fs.statSync(outPath).size;
          if (compressedSize >= originalSize) {
            try { fs.unlinkSync(outPath); } catch {}
            return resolve({ skipped: true, reason: 'compressed larger than original', path: inputPath, originalSize });
          }
          if (inputPath !== outPath) try { fs.unlinkSync(inputPath); } catch {}
          return resolve({ success: true, path: outPath, originalSize, compressedSize, ratio: ((1 - compressedSize / originalSize) * 100).toFixed(1) + '%' });
        }

        resolve({ skipped: true, reason: 'no compression tool available', path: inputPath, originalSize });
      });
    });
  });
}

module.exports = { compress };
