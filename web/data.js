import { unzlibSync } from 'fflate';

export function unpack(bundle) {
  const raw = unzlibSync(Uint8Array.from(atob(bundle.payload), c => c.charCodeAt(0)));
  const data = {manifest: bundle.manifest};
  for (const [name, f] of Object.entries(bundle.manifest.fields)) {
    const slice = raw.slice(f.offset, f.offset + f.bytes);
    const a = f.dtype === '<i2' ? new Int16Array(slice.buffer) :
      f.dtype === '<i4' ? new Int32Array(slice.buffer) : new Uint8Array(slice.buffer);
    data[name] = Float64Array.from(a, v => v === f.missing ? NaN : v / f.scale);
  }
  return data;
}
export const index = (s,e,m,j,width=8) => ((s*4+e)*391+m)*width+j;
export const clock = m => {
  const seconds = Math.round((570+m)*60);
  const hh = String(Math.floor(seconds/3600)).padStart(2,'0');
  const mm = String(Math.floor(seconds/60)%60).padStart(2,'0');
  return `${hh}:${mm}${seconds%60 ? ':30' : ''}`;
};
export function statistics(data, session, window, field='values', width=8) {
  const mean = new Float64Array(4*391*width).fill(NaN);
  const std = new Float64Array(mean.length).fill(NaN);
  const count = new Uint8Array(mean.length);
  const z = new Float64Array(mean.length).fill(NaN);
  for(let e=0;e<4;e++) for(let m=0;m<391;m++) for(let j=0;j<width;j++) {
    let n=0, avg=0, m2=0;
    for(let s=Math.max(0,session-window);s<session;s++) {
      const v=data[field][index(s,e,m,j,width)];
      if(!Number.isFinite(v)) continue;
      n++; const d=v-avg; avg+=d/n; m2+=d*(v-avg);
    }
    const a=(e*391+m)*width+j;
    count[a]=n;
    const sd=Math.sqrt(m2/(n-1));
    if(n>=8 && sd>1e-8) {
      mean[a]=avg; std[a]=sd;
      z[a]=(data[field][index(session,e,m,j,width)]-avg)/sd;
    }
  }
  return {mean,std,count,z};
}
export function crossings(stats, expiry, length, step=1) {
  const result=[];
  for(let m=step;m<length;m+=step) for(let j=0;j<8;j++) {
    const a=stats.z[(expiry*391+Math.floor(m))*8+j];
    const b=stats.z[(expiry*391+Math.floor(m-step))*8+j];
    if(!Number.isFinite(a)||!Number.isFinite(b)) continue;
    for(const t of [2,3,-2,-3]) {
      if(t>0 ? a>=t&&b<t : a<=t&&b>t) result.push({m,j,z:a,threshold:t});
    }
  }
  return result;
}
export function sampledMinutes(length, seconds, until=length-1) {
  const out=[];
  for(let m=0;m<=Math.min(until,length-1)+1e-8;m+=seconds/60) out.push(m);
  return out;
}
