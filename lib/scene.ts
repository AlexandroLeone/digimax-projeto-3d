import * as T from 'three';
import {Project,Item} from './model';

type Node=T.Object3D;
const finite=(value:number|undefined,fallback=0)=>Number.isFinite(value)?value:fallback;
const safeColor=(color:string|undefined,fallback='#c9cfcc')=>typeof color==='string'&&color.trim()?color:fallback;
const material=(color:string|undefined,roughness=.72,metalness=0,opacity=1)=>new T.MeshStandardMaterial({color:safeColor(color),roughness,metalness,transparent:opacity<1,opacity});
const box=(g:Node,x:number,y:number,z:number,w:number,h:number,d:number,color:string|undefined,opacity=1,roughness=.72,metalness=0)=>{const m=new T.Mesh(new T.BoxGeometry(Math.max(.005,finite(w,.1)),Math.max(.005,finite(h,.1)),Math.max(.005,finite(d,.1))),material(color,roughness,metalness,opacity));m.position.set(finite(x),finite(y),finite(z));m.castShadow=true;m.receiveShadow=true;g.add(m);return m};
const cyl=(g:Node,x:number,y:number,z:number,r:number,h:number,color:string|undefined,segments=20,rot?:[number,number,number])=>{const radius=Math.max(.005,finite(r,.05)),height=Math.max(.005,finite(h,.05));const m=new T.Mesh(new T.CylinderGeometry(radius,radius,height,segments),material(color,.45,.08));m.position.set(finite(x),finite(y),finite(z));if(rot)m.rotation.set(...rot);m.castShadow=true;m.receiveShadow=true;g.add(m);return m};
const sphere=(g:Node,x:number,y:number,z:number,r:number,color:string|undefined)=>{const m=new T.Mesh(new T.SphereGeometry(Math.max(.005,finite(r,.1)),18,12),material(color,.78));m.position.set(finite(x),finite(y),finite(z));m.castShadow=true;m.receiveShadow=true;g.add(m);return m};

function furniture(g:T.Group,i:Item){
  const w=Math.max(.05,finite(i.w,1)),d=Math.max(.05,finite(i.d,.7)),h=Math.max(.05,finite(i.h,.8)),c=safeColor(i.color,'#aa8969'),light='#f5f1e7',dark='#665243';
  const b=(x:number,y:number,z:number,ww:number,hh:number,dd:number,col=c,op=1,r=.72,m=0)=>box(g,x,y,z,ww,hh,dd,col,op,r,m);
  const foot=(x:number,z:number)=>cyl(g,x,.08,z,.045,.16,dark,12);
  const seat=(x:number,z:number,rot=0)=>{const s=new T.Group();s.position.set(x,0,z);s.rotation.y=rot;g.add(s);box(s,0,.46,0,.42,.12,.42,c);box(s,0,.82,-.16,.42,.68,.1,c);for(const sx of [-.16,.16])for(const sz of [-.14,.14])box(s,sx,.23,sz,.045,.46,.045,dark)};
  if(i.kind==='sofa'){
    b(0,.25,0,w,.42,d,c);b(0,.62,-d/2+.1,w,.72,.18,c);b(-w/2+.1,.52,0,.18,.58,d,c);b(w/2-.1,.52,0,.18,.58,d,c);
    const n=Math.max(1,Math.min(4,Math.round(w/.65)));for(let j=0;j<n;j++){const x=-w/2+.2+(w-.4)*(j+.5)/n;b(x,.48,.02,(w-.48)/n,.16,d*.72,'#c9c2b3');b(x,.62,-d*.42,(w-.5)/n,.2,.1,'#e4ded1')}
    foot(-w*.38,-d*.36);foot(w*.38,-d*.36);foot(-w*.38,d*.36);foot(w*.38,d*.36);
  }else if(i.kind==='bed'){
    b(0,.2,0,w,.34,d,c);b(0,.43,0,w*.96,.2,d*.93,light);b(0,.59,d*.16,w*.94,.08,d*.57,c);b(0,.64,-d/2+.04,w,.9,.1,c);
    for(const x of w>1?[-w*.25,w*.25]:[0])b(x,.6,-d*.3,w*.36,.13,.36,'#fffdf7');foot(-w*.42,-d*.4);foot(w*.42,-d*.4);foot(-w*.42,d*.4);foot(w*.42,d*.4);
  }else if(i.kind==='table'){
    b(0,h-.05,0,w,.1,d,c,.98,.55);for(const x of [-w*.38,w*.38])for(const z of [-d*.32,d*.32]){b(x,h/2,z,.07,h,.07,dark);foot(x,z)}
  }else if(i.kind==='diningtable'||(i.name||'').toLowerCase().includes('6 cadeiras')){
    b(0,h-.05,0,w,.1,d,c,.98,.55,.58);for(const x of [-w*.38,w*.38])for(const z of [-d*.32,d*.32])b(x,h/2,z,.07,h,.07,dark);
    for(const x of [-w*.32,0,w*.32]){seat(x,-d/2-.28,0);seat(x,d/2+.28,Math.PI)}
  }else if(i.kind==='chair'){
    b(0,.45,0,w*.88,.12,d*.82,c);b(0,.82,-d/2+.08,w*.88,.7,.12,c);for(const x of [-w*.35,w*.35])for(const z of [-d*.3,d*.3])b(x,.23,z,.055,.46,.055,dark);b(0,.5,0,w*.68,.07,d*.56,'#c8c0af');
  }else if(i.kind==='cabinet'){
    b(0,h/2,0,w,h,d,c);b(0,h*.5,d/2+.012,w*.93,h*.84,.025,'#c9a781');b(0,h*.5,d/2+.03,.018,h*.78,.035,dark);b(-w*.22,h*.5,d/2+.06,.04,.04,.04,'#d6b777',1,.35,.3);b(w*.22,h*.5,d/2+.06,.04,.04,.04,'#d6b777',1,.35,.3);for(const z of [-d*.25,d*.25])b(0,.03,z,w*.88,.04,.02,'#7d6048');
  }else if(i.kind==='bookcase'){
    b(0,h/2,0,w,h,d,'#8b674b');for(const y of [.28,.58,.88])b(0,h*y,d/2+.02,w*.92,.045,.035,'#d0a777');b(-w/2+.06,h/2,d/2+.02,.06,h-.12,.04,dark);b(w/2-.06,h/2,d/2+.02,.06,h-.12,.04,dark);
    for(const y of [.38,.68])for(const x of [-w*.28,0,w*.28])b(x,h*y,d/2+.06,w*.14,.18,.04,['#c88f65','#6d9182','#d1b46e'][Math.abs(Math.round(x*10))%3]);
  }else if(i.kind==='tvpanel'){
    b(0,h/2,0,w,.08,d,'#a37a59');b(0,h*.58,d/2+.04,w*.86,h*.55,.04,'#1e282d',1,.22,.15);b(0,h*.58,d/2+.07,w*.72,h*.43,.015,'#58848d',1,.2);b(0,.12,0,w*.9,.2,d*.85,'#9b7657');
  }else if(i.kind==='rug'){
    b(0,.015,0,w,.03,d,'#c99078',1,.9);b(0,.032,0,w-.14,.01,d-.14,'#e5b08f',1,.9);for(const x of [-w*.25,0,w*.25])b(x,.04,0,.018,.008,d*.75,'#b87669');for(const z of [-d*.25,0,d*.25])b(0,.04,z,w*.75,.008,.018,'#b87669');
  }else if(i.kind==='nightstand'){
    b(0,h/2,0,w,h,d,'#aa805b');for(const y of [.28,.58,.82]){b(0,h*y,d/2+.03,w*.84,.025,.03,'#76533e');b(0,h*y+.08,d/2+.04,w*.74,.16,.025,'#c39b6e');}
  }else if(i.kind==='desk'){
    b(0,h-.06,0,w,.12,d,'#9b7656');for(const x of [-w*.4,w*.4])b(x,h/2,0,.07,h-.1,.07,dark);b(0,h+.02,-d*.18,w*.55,.025,.02,'#d9c2a2');
  }else if(i.kind==='microwave'){
    b(0,h/2,0,w,h,d,'#637075',1,.35,.1);b(-w*.08,h*.55,d/2+.03,w*.62,h*.55,.02,'#202b2f',1,.2,.1);b(-w*.08,h*.55,d/2+.05,w*.52,h*.43,.012,'#6f9ca3');for(const y of [.3,.6])cyl(g,w*.34,h*y,d/2+.05,.035,.04,'#ddbf7a',14,[Math.PI/2,0,0]);
  }else if(i.kind==='wallcabinet'){
    b(0,h/2,0,w,h,d,'#ded0bb');b(0,h*.5,d/2+.03,.025,h*.85,.03,'#aa8769');for(const x of [-w*.25,w*.25]){b(x,h*.52,d/2+.04,w*.42,h*.78,.025,'#eadfcd');cyl(g,x+(x<0?.12:-.12),h*.5,d/2+.07,.025,.05,'#896b53',12,[Math.PI/2,0,0])}
  }else if(i.kind==='barstool'){
    cyl(g,0,.74,0,Math.min(w,d)*.36,.12,'#c59a68',20);cyl(g,0,.38,0,.045,.68,dark,12);for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const x=Math.cos(a)*w*.25,z=Math.sin(a)*d*.25;b(x,.08,z,.045,.16,.045,dark)}
  }else if(i.kind==='towelrack'){
    for(const y of [.35,.7]){cyl(g,0,y,0,.025,w*.9,'#718785',16,[0,0,Math.PI/2]);for(const x of [-w*.4,w*.4])cyl(g,x,y,0,.03,.1,'#718785',12)}
  }else if(i.kind==='vanity'){
    b(0,h*.42,0,w,h*.72,d,'#b08a67');b(0,h*.82,0,w+.04,.08,d+.04,'#f2f4ef',1,.25);cyl(g,0,h*.86,0,Math.min(w,d)*.27,.05,'#cbd9d5',24);cyl(g,w*.18,h*1.03,-d*.2,.025,.22,'#718984',16);b(0,h*.12,0,w*.85,.08,d*.85,'#d2ae7c');
  }else if(i.kind==='mirror'){
    b(0,h/2,0,w,.04,d,'#d9e8e7',.8,.18,.05);b(-w*.18,h*.62,-d/2-.02,.025,.02,.02,'#fff',.9);b(w*.2,h*.35,-d/2-.02,.025,.02,.02,'#fff',.9);
  }else if(i.kind==='pergola'){
    const post=.1;for(const x of [-w/2+post,w/2-post])for(const z of [-d/2+post,d/2-post])b(x,h/2,z,post,h,post,'#8b674b');for(const x of [-w/2+post,w/2-post])b(x,h,0,post+.03,.1,d,'#a47954');for(const z of [-d/2+post,d/2-post])b(0,h,z,w,.1,post+.03,'#a47954');
  }else if(i.kind==='washer'||i.kind==='washerdryer'){
    b(0,h/2,0,w,h,d,'#cbd6d6',1,.3,.05);cyl(g,0,h*.5,d/2+.02,Math.min(w,d)*.28,.04,'#7e9697',24,[Math.PI/2,0,0]);cyl(g,0,h*.5,d/2+.045,Math.min(w,d)*.17,.02,'#dbe8e5',24,[Math.PI/2,0,0]);for(const x of [-w*.3,0,w*.3])cyl(g,x,h*.88,d/2+.03,.025,.03,'#d0b272',12,[Math.PI/2,0,0]);
  }else if(i.kind==='tank'){
    b(0,h*.5,0,w,h,d,'#ddd8c6',1,.7);cyl(g,0,h+.02,0,Math.min(w,d)*.26,.04,'#a5b7b1',18);cyl(g,w*.18,h+.1,-d*.18,.025,.2,'#758d88',14);
  }else if(i.kind==='clothesline'){
    for(const x of [-w*.42,w*.42])b(x,h/2,0,.05,h,.05,'#758e88');cyl(g,0,h*.78,0,.018,w*.86,'#a47a5e',14,[0,0,Math.PI/2]);for(const x of [-w*.25,0,w*.25])b(x,h*.58,0,.03,.22,.03,'#d7b66e');
  }else if(i.kind==='officechair'){
    b(0,.58,0,w*.8,.14,d*.75,'#59756f');b(0,.98,-d*.22,w*.8,.72,.12,'#3d5c58');cyl(g,0,.32,0,.04,.55,'#566a67',14);for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const x=Math.cos(a)*w*.36,z=Math.sin(a)*d*.36;b(x,.08,z,.035,.06,.035,'#566a67')}
  }else if(i.kind==='drawer'){
    b(0,h/2,0,w,h,d,'#a57a58');for(const y of [.2,.45,.7,.85]){b(0,h*y,d/2+.03,w*.86,.16,.025,'#c79a6f');cyl(g,0,h*y,d/2+.06,.025,.04,'#e3c487',12,[Math.PI/2,0,0])}
  }else if(i.kind==='computer'){
    b(0,h*.55,0,w*.88,h*.58,.05,'#27383d',1,.22,.08);b(0,h*.55,d/2+.03,w*.76,h*.42,.015,'#74a4aa',1,.22);b(0,h*.2,0,.04,.25,.04,dark);b(0,.06,0,w*.35,.03,d*.18,dark);
  }else if(i.kind==='divider'){
    b(0,h/2,0,w,.06,d,'#b7c9c0',.55,.7);for(const x of [-w*.4,w*.4])b(x,h/2,0,.05,h,.05,'#718f83');
  }else if(i.kind==='island'){
    b(0,h*.46,0,w,h*.85,d,'#8b6b50');b(0,h,0,w+.06,.1,d+.06,'#d6c1a3');for(const x of [-w*.3,0,w*.3])b(x,h*.2,0,.02,.18,d*.7,dark);
  }else if(i.kind==='planned'){
    b(0,h/2,0,w,h,d,'#cfa275');for(const x of [-w*.3,0,w*.3])b(x,h*.5,d/2+.03,.025,h*.85,.03,'#79563f');
  }else if(i.kind==='stairs'){
    const steps=7;for(let n=0;n<steps;n++)b(0,.08+n*(h/steps),-d/2+d*(n+.5)/steps,w,h/steps,d*(n+1)/steps,'#cbb79d');
  }else if(i.kind==='tv'){
    b(0,h*.52,0,w,.08,d,c);b(0,h*.52,d/2+.025,w*.93,h*.78,.04,'#151d22',1,.2,.1);b(0,h*.52,d/2+.05,w*.78,h*.57,.012,'#557f8c',.95,.3);b(0,.07,0,w*.35,.12,.16,dark);
  }else if(i.kind==='fridge'){
    b(0,h/2,0,w,h,d,'#cbd5d7',1,.3,.12);b(0,h*.62,d/2+.01,w-.05,.025,.018,'#a4b0b2');b(w*.34,h*.77,d/2+.05,.035,.48,.035,'#657578',1,.35,.15);b(w*.34,h*.25,d/2+.05,.035,.2,.035,'#657578',1,.35,.15);
  }else if(i.kind==='stove'){
    b(0,h/2,0,w,h,d,'#596568',1,.4,.1);for(const x of [-w*.25,w*.25])for(const z of [-d*.23,d*.23])cyl(g,x,h+.015,z,Math.min(w,d)*.15,.025,'#20282a',24);b(0,h*.88,-d/2-.015,w*.7,.05,.025,'#b99a63',1,.45,.1);b(0,h*.4,-d/2-.015,w*.75,.035,.025,'#283235');
  }else if(i.kind==='sink'){
    b(0,h*.5,0,w,h,d,c);b(0,h+.015,0,w*.78,.04,d*.72,'#f0f3ef',1,.25);b(0,h+.04,0,w*.4,.035,d*.42,'#bdcbc8',1,.18);cyl(g,w*.18,h+.17,-d*.28,.025,.28,'#718984',16);cyl(g,w*.18,h+.29,-d*.4,.025,.18,'#718984',16,[Math.PI/2,0,0]);
  }else if(i.kind==='counter'){
    b(0,h/2,0,w,h,d,c);b(0,h+.02,0,w+.04,.08,d+.04,'#d5c0a1',1,.5);for(const x of [-w*.3,w*.3])b(x,h*.42,d/2+.02,w*.22,.05,.025,dark);
  }else if(i.kind==='toilet'){
    b(0,.18,.07,w*.72,.35,d*.62,'#f5f7f3',1,.28);b(0,.5,-d*.28,w*.72,.6,d*.25,'#f5f7f3',1,.28);cyl(g,0,.37,.12,w*.27,.05,'#cbd7d4',24);b(0,.67,-d*.41,w*.5,.04,.03,'#b6c5c1');
  }else if(i.kind==='shower'){
    b(0,.03,0,w,.06,d,'#e5eae8',1,.3);b(-w/2,.95,0,.025,1.9,d,'#a7caca',.28,.15);b(0,.95,d/2,w,1.9,.025,'#a7caca',.28,.15);cyl(g,w*.3,1.75,d*.22,.16,.035,'#a9b8b5',18,[Math.PI/2,0,0]);
  }else if(i.kind==='showerhead'){
    cyl(g,0,h*.58,0,.035,h*.9,'#7d8b89',16);cyl(g,0,h,0,Math.min(w,d)*.24,.04,'#bbc8c5',18);cyl(g,0,h+.04,0,Math.min(w,d)*.16,.02,'#829591',18);
  }else if(i.kind==='grill'){
    b(0,.65,0,w,.9,d,'#626d6b',1,.5,.08);b(0,.84,0,w*.82,.04,d*.78,'#d1ad6b',1,.35);for(const x of [-w*.33,0,w*.33])b(x,.9,0,.025,.07,d*.72,dark);for(const x of [-w*.35,w*.35])b(x,.18,0,.06,.36,.06,dark);
  }else if(i.kind==='pool'){
    b(0,.06,0,w,.12,d,'#d8d4c8',1,.8);b(0,.12,0,w-.3,.05,d-.3,'#6fb7ce',.95,.18);for(const x of [-w*.25,0,w*.25])b(x,.15,0,.03,.01,d*.7,'#d5f2f3',.8,.15);
  }else if(i.kind==='garden'){
    b(0,.1,0,w,.2,d,'#77955d');for(let x=-w*.3;x<=w*.3;x+=Math.max(.3,w/3)){cyl(g,x,.35,0,.04,.42,'#547545',12);sphere(g,x,.65,0,Math.min(.28,d*.35),'#6f9a63')}
  }else{
    b(0,h/2,0,w,h,d,c);b(0,h*.64,d/2+.02,w*.9,.03,.02,'#87674e');
  }
}

export function model(p:Project,ceil=false,cut=false,includeFurniture=true){
  const root=new T.Group();root.name=p.name;
  for(const r of p.rooms){
    const rx=finite(r.x),ry=finite(r.y),rw=Math.max(.2,finite(r.w,1)),rd=Math.max(.2,finite(r.d,1)),rc=safeColor(r.color,'#d9ddd8');
    box(root,rx+rw/2,-.04,ry+rd/2,rw,.08,rd,rc);
    if(r.material==='Madeira')for(let z=ry+.16;z<ry+rd;z+=.16)box(root,rx+rw/2,.001,z,rw,.002,.007,'#9e815f');
    else{for(let z=ry+.6;z<ry+rd;z+=.6)box(root,rx+rw/2,.001,z,rw,.002,.01,'#b3b9b5');for(let x=rx+.6;x<rx+rw;x+=.6)box(root,x,.001,ry+rd/2,.01,.002,rd,'#b3b9b5');}
    if(ceil)box(root,rx+rw/2,2.84,ry+rd/2,rw,.08,rd,'#f7f6ef');
  }
  for(const w of p.walls){
    const x1=finite(w.x1),y1=finite(w.y1),x2=finite(w.x2),y2=finite(w.y2),thickness=Math.max(.05,finite(w.t,.15)),wallHeight=Math.max(.2,finite(w.h,2.8));
    const L=Math.hypot(x2-x1,y2-y1);if(L<.02)continue;
    const g=new T.Group();g.position.set(x1,0,y1);g.rotation.y=-Math.atan2(y2-y1,x2-x1);root.add(g);
    const H=cut?Math.min(.65,wallHeight):wallHeight,wallColor=safeColor(w.color,'#f0eeea');const openings=p.items.filter(i=>i.wall===w.id).map(i=>{const width=Math.max(.05,finite(i.w,.8));const at=Math.max(0,Math.min(1,finite(i.at,.5)));return {i,a:Math.max(0,at*L-width/2),b:Math.min(L,at*L+width/2)}}).sort((a,b)=>a.a-b.a);let cursor=0;
    for(const o of openings){
      if(o.a>cursor)box(g,(cursor+o.a)/2,H/2,0,o.a-cursor,H,wallColor);
      const sill=o.i.kind==='door'?0:Math.max(0,finite(o.i.sill,1)),top=Math.min(wallHeight,sill+Math.max(.05,finite(o.i.h,o.i.kind==='door'?2.1:1.2)));
      if(sill>0)box(g,(o.a+o.b)/2,Math.min(H,sill)/2,0,o.b-o.a,Math.min(H,sill),thickness,wallColor);
      if(top<H)box(g,(o.a+o.b)/2,(top+H)/2,0,o.b-o.a,H-top,thickness,wallColor);
      if(!cut){
        const c=(o.a+o.b)/2,ow=o.b-o.a,col=safeColor(o.i.color,'#a97951');box(g,c,sill+.025,0,ow,.05,thickness+.025,col);box(g,c,top-.025,0,ow,.05,thickness+.025,col);box(g,o.a+.025,(sill+top)/2,0,.05,top-sill,thickness+.025,col);box(g,o.b-.025,(sill+top)/2,0,.05,top-sill,thickness+.025,col);
        if(o.i.kind==='window'){box(g,c,(sill+top)/2,0,Math.max(.02,ow-.08),Math.max(.02,top-sill-.08),.02,'#a1cddd',.3);box(g,c,(sill+top)/2,0,.035,Math.max(.02,top-sill),.07,col);}
        else if((o.i.name||'').includes('correr')){box(g,c-ow*.2,top/2,0,ow*.6,Math.max(.02,top-.06),.04,col);box(g,c+ow*.2,top/2,.07,ow*.6,Math.max(.02,top-.06),.04,col);}
        else{const double=(o.i.name||'').includes('dupla');for(let n=0;n<(double?2:1);n++){const door=new T.Group();door.position.set(n===0?o.a:o.b,0,0);door.rotation.y=n===0?-.55:.55;g.add(door);const width=ow/(double?2:1);box(door,n===0?width/2:-width/2,top/2,0,Math.max(.02,width-.03),Math.max(.02,top-.05),.045,col);}}
      }
      cursor=Math.max(cursor,o.b);
    }
    if(cursor<L)box(g,(cursor+L)/2,H/2,0,L-cursor,H,thickness,wallColor);
  }
  if(includeFurniture)for(const i of p.items.filter(i=>!i.wall)){const ix=finite(i.x),iy=finite(i.y),iw=Math.max(.05,finite(i.w,1)),id=Math.max(.05,finite(i.d,.7));const g=new T.Group();g.name=i.name||'Móvel';g.userData.itemId=i.id;g.position.set(ix+iw/2,0,iy+id/2);g.rotation.y=-finite(i.angle)*Math.PI/180;root.add(g);furniture(g,i);}
  return root;
}

export function dispose(root:T.Object3D){root.traverse((o:any)=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach((m:any)=>m.dispose())});}
