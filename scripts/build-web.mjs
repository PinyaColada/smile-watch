import {build} from 'esbuild';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const text=async p=>readFile(path.join(root,p),'utf8');
const repo=process.env.SMILE_WATCH_REPO || 'https://github.com/jaumevaquer/smile-watch';
const bundle=await build({entryPoints:[path.join(root,'web/app.js')],bundle:true,minify:true,write:false,format:'iife',target:['es2020'],legalComments:'inline'});
let css=await text('web/style.css');
let fonts='';
for(const family of['sans','mono'])for(const weight of[400,500]){
  const file=`node_modules/@fontsource/ibm-plex-${family}/files/ibm-plex-${family}-latin-${weight}-normal.woff2`;
  const data=await readFile(path.join(root,file));
  fonts+=`@font-face{font-family:'IBM Plex ${family==='sans'?'Sans':'Mono'}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2')}\n`;
}
css=css.replace('/* FONTS */',fonts);
const app=bundle.outputFiles[0].text;
const html=(await text('web/index.html')).replace('/* STYLES */',css).replace('/* DATA */',await text('docs/data/replay.json')).replace('/* APP */',app.replaceAll('</script','<\\/script')).replaceAll('REPO_URL',repo);
await mkdir(path.join(root,'docs/assets'),{recursive:true});
await writeFile(path.join(root,'docs/index.html'),html);
await writeFile(path.join(root,'docs/.nojekyll'),'');
// Runtime dependencies and fonts are vendored inside the self-contained HTML.
const licenseFiles=[['three','LICENSE'],['fflate','LICENSE'],['@fontsource/ibm-plex-sans','LICENSE'],['@fontsource/ibm-plex-mono','LICENSE']];
let licenses='All runtime libraries are bundled locally into index.html; no CDNs.\n\n';
for(const[name,file]of licenseFiles){licenses+=`=== ${name} ===\n${await text(`node_modules/${name}/${file}`)}\n\n`;}
await writeFile(path.join(root,'docs/assets/THIRD_PARTY_LICENSES.txt'),licenses);
console.log(`Built self-contained docs/index.html: ${(Buffer.byteLength(html)/1048576).toFixed(2)} MiB`);
