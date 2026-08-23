// 找出 JSX 中使用但三份 CSS 都未定义的类名
import { readFileSync } from 'fs';
const read = p => readFileSync(p, 'utf-8');
const jsx = read('app/src/App.tsx');
const cssSrcs = ['app/src/index.css'].map(read).join('\n');

const jsxClasses = new Set();
const re = /className=\{?["`]([^"`]+)["`]\}?/g;
let m;
while ((m = re.exec(jsx))) {
  for (const c of m[1].split(/\s+/)) {
    if (c && !c.includes('${')) jsxClasses.add(c);
  }
}

const defined = new Set();
for (const mm of cssSrcs.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(mm[1]);

const missing = [...jsxClasses].filter(c => !defined.has(c)).sort();
console.log('JSX 使用且 CSS 未定义的类 (' + missing.length + '):');
console.log(missing.join(' ') || '(无)');
console.log('JSX 类总数: ' + jsxClasses.size);
