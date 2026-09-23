// Original minimal electronic score, synthesized locally. No external samples.
import fs from 'node:fs';
const rate=44100,seconds=30,frames=rate*seconds,b=Buffer.alloc(44+frames*4);
b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*4,40);
const cuts=[0,2.2,4.4,7.4,9.8,11.6,17,20,24,27];const notes=[293.665,440,587.33,659.255,440,391.995,587.33,440];let seed=173;
for(let i=0;i<frames;i++){
 const t=i/rate;seed=(seed*1664525+1013904223)>>>0;const noise=seed/2147483648-1;
 const beat=t%.5,arp=t%.25,n=notes[Math.floor(t/.25)%notes.length];
 const kick=Math.sin(2*Math.PI*(46*beat+2.1*(1-Math.exp(-beat*35))))*Math.exp(-beat*17)*.25;
 const hat=noise*Math.exp(-((t+.25)%.5)*95)*.025;
 const ping=(Math.sin(2*Math.PI*n*arp)+.18*Math.sin(2*Math.PI*n*2*arp))*Math.exp(-arp*16)*Math.min(1,arp*500)*.045;
 const pad=(Math.sin(2*Math.PI*146.832*t)+Math.sin(2*Math.PI*220.15*t)+Math.sin(2*Math.PI*293.665*t))*.022*(.7+.3*Math.sin(t*.5));
 let accent=0;for(const cut of cuts){const dt=t-cut;if(dt>=0&&dt<.7)accent+=(Math.sin(2*Math.PI*880*dt)*.025+noise*.055)*Math.exp(-dt*11)*Math.min(1,dt*90);}
 const fade=Math.min(1,t/.3,Math.max(0,(30-t)/1.7));const v=(kick+hat+ping+pad+accent)*fade;
 b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*4);b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v*.96+Math.sin(t*2*Math.PI*440.3)*.009*fade))*32767),46+i*4);
}fs.writeFileSync('promo/v142/apple30-score.wav',b);
