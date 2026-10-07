import { execFileSync } from 'child_process';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'public', 'login-cane-field.jpg');
const output = path.join(root, 'public', 'login-cane-wind.mp4');

if (!fs.existsSync(input)) {
  console.error('Imagem não encontrada:', input);
  process.exit(1);
}

// Loop suave: zoom + pan simulam vento e deriva do céu/nuvens (16s, 30fps)
const vf = [
  'scale=1920:1080:force_original_aspect_ratio=increase',
  'crop=1920:1080',
  "zoompan=z='1.04+0.028*sin(2*PI*on/480)':x='iw/2-(iw/zoom/2)+50*sin(2*PI*on/360)':y='ih/2-(ih/zoom/2)+8*sin(2*PI*on/420)':d=480:s=1920x1080:fps=30",
].join(',');

console.log('Gerando', output, '...');

execFileSync(
  ffmpegPath.path,
  [
    '-y',
    '-loop',
    '1',
    '-i',
    input,
    '-vf',
    vf,
    '-t',
    '16',
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ],
  { stdio: 'inherit' },
);

const sizeMb = (fs.statSync(output).size / (1024 * 1024)).toFixed(2);
console.log(`Pronto: ${output} (${sizeMb} MB)`);
