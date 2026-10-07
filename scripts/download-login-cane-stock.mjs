import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stockDir = path.join(root, 'public', '_stock-tmp');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// Pexels — cana-de-açúcar real (royalty-free)
const sources = [
  {
    url: 'https://www.pexels.com/download/video/5147802/',
    file: 'sugarcane-field-hd.mp4',
    note: 'plantio de cana em paisagem rural (1920x1080)',
  },
  {
    url: 'https://www.pexels.com/download/video/7456809/',
    file: 'sugarcane-stalks-uhd.mp4',
    note: 'close-up de colmos de cana sob céu azul',
  },
  {
    url: 'https://assets.mixkit.co/videos/4070/4070-720.mp4',
    file: 'clouds-meadow.mp4',
    note: 'nuvens em timelapse (camada opcional de céu)',
  },
];

fs.mkdirSync(stockDir, { recursive: true });

for (const { url, file, note } of sources) {
  const target = path.join(stockDir, file);
  if (fs.existsSync(target) && fs.statSync(target).size > 1_000_000) {
    console.log('Já existe:', file);
    continue;
  }
  console.log('Baixando', file, '-', note);
  execFileSync('curl', ['-L', '-o', target, url, '-H', `User-Agent: ${ua}`], { stdio: 'inherit' });
}

console.log('Clipes salvos em', stockDir);
