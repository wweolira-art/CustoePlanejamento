import { execFileSync } from 'child_process';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stockDir = path.join(root, 'public', '_stock-tmp');
const output = path.join(root, 'public', 'login-cane-wind.mp4');

const field = path.join(stockDir, 'sugarcane-field-hd.mp4');
const clouds = path.join(stockDir, 'clouds-meadow.mp4');

if (!fs.existsSync(field)) {
  console.error('Vídeo de cana ausente. Rode: npm run download:login-cane-stock');
  process.exit(1);
}

const hasClouds = fs.existsSync(clouds);

// Plantação de cana-de-açúcar real (Pexels #5147802) + nuvens em movimento (Mixkit #4070)
const filter = hasClouds
  ? [
      '[0:v]trim=start=8:duration=20,setpts=PTS-STARTPTS,',
      'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1[field];',
      '[1:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,',
      'trim=duration=20,setpts=PTS-STARTPTS[cloudfull];',
      '[cloudfull]crop=1920:460:0:0,format=rgba,',
      "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(Y,320),200,if(gt(Y,440),0,200*(440-Y)/120))'[sky];",
      '[field][sky]overlay=0:0:format=auto,format=yuv420p[out]',
    ].join('')
  : [
      '[0:v]trim=start=8:duration=20,setpts=PTS-STARTPTS,',
      'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,format=yuv420p[out]',
    ].join('');

const args = ['-y', '-i', field];
if (hasClouds) {
  args.push('-stream_loop', '-1', '-i', clouds);
}
args.push(
  '-filter_complex',
  filter,
  '-map',
  '[out]',
  '-t',
  '20',
  '-r',
  '30',
  '-c:v',
  'libx264',
  '-crf',
  '24',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  output,
);

console.log('Montando vídeo de cana-de-açúcar para login...');

execFileSync(ffmpegPath.path, args, { stdio: 'inherit' });

const sizeMb = (fs.statSync(output).size / (1024 * 1024)).toFixed(2);
console.log(`Pronto: ${output} (${sizeMb} MB)`);
console.log('Fonte principal: Pexels #5147802 — plantio de cana-de-açúcar');
if (hasClouds) console.log('Céu: Mixkit #4070 — nuvens em timelapse');
