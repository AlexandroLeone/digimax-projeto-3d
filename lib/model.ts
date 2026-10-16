export type Wall={id:string,x1:number,y1:number,x2:number,y2:number,t:number,h:number,color:string,room?:string};
export type Room={id:string,name:string,x:number,y:number,w:number,d:number,color:string,material:string,locked?:boolean};
export type Item={id:string,name:string,kind:string,x:number,y:number,w:number,d:number,h:number,angle:number,color:string,wall?:string,at?:number,sill?:number};
export type Project={version:1,id:string,name:string,w:number,d:number,walls:Wall[],rooms:Room[],items:Item[],updated:number};
export const id=()=>Math.random().toString(36).slice(2,10);export const fmt=(v:number)=>v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
export const names=['Sala','Cozinha','Quarto','Suíte','Banheiro','Lavanderia','Garagem','Área gourmet','Escritório','Corredor'];
export const catalog:Record<string,[string,string,number,number,number][]>= {'Sala':[['Sofá','sofa',2.2,.9,.85],['TV','tv',1.3,.12,.8],['Rack','cabinet',1.8,.4,.5],['Mesa de centro','table',1,.6,.4],['Mesa de jantar com 6 cadeiras','diningtable',1.8,1.05,.78],['Poltrona','chair',.8,.8,.8]],'Quarto':[['Cama de solteiro','bed',.9,1.9,.5],['Cama de casal','bed',1.38,1.9,.5],['Cama queen','bed',1.58,1.98,.5],['Guarda-roupa','cabinet',2,.6,2.2],['Criado-mudo','cabinet',.45,.4,.5]],'Cozinha':[['Geladeira','fridge',.7,.7,1.8],['Fogão','stove',.6,.6,.9],['Pia','sink',1.2,.6,.9],['Bancada','counter',1.8,.65,.9],['Armários','cabinet',1.2,.6,2.1],['Mesa','table',1.5,.9,.75],['Cadeira','chair',.45,.45,.8]],'Banheiro':[['Vaso sanitário','toilet',.4,.65,.45],['Pia de banheiro','sink',.6,.5,.85],['Box','shower',.9,.9,2.1],['Chuveiro','showerhead',.2,.3,2.2]],'Área externa':[['Churrasqueira','grill',.9,.65,1.8],['Mesa externa','table',1.5,.9,.75],['Cadeira externa','chair',.5,.5,.8],['Piscina','pool',3,5,.2],['Jardim','garden',2,1,.3]]};
export const blank=(name='Meu projeto',w=12,d=15):Project=>({version:1,id:id(),name,w,d,walls:[],rooms:[],items:[],updated:Date.now()});
export const wall=(x1:number,y1:number,x2:number,y2:number,room?:string):Wall=>({id:id(),x1,y1,x2,y2,t:.15,h:2.8,color:'#f0eeea',room});
export function roomWalls(r:Room){return [wall(r.x,r.y,r.x+r.w,r.y,r.id),wall(r.x+r.w,r.y,r.x+r.w,r.y+r.d,r.id),wall(r.x+r.w,r.y+r.d,r.x,r.y+r.d,r.id),wall(r.x,r.y+r.d,r.x,r.y,r.id)]}
const roundCoord=(value:number)=>Math.round(value*1000)/1000;
function wallKey(w:Wall){const a=`${roundCoord(w.x1)},${roundCoord(w.y1)}`,b=`${roundCoord(w.x2)},${roundCoord(w.y2)}`;return a<b?`${a}|${b}`:`${b}|${a}`}
/**
 * Removes coincident wall segments while keeping the first wall as the
 * canonical edge. Room generation can create the same shared edge twice;
 * rendering both edges makes a wall look doubled and also duplicates it in
 * the 3D scene. Openings that pointed to a removed duplicate are reassigned
 * to the canonical wall id.
 */
export function normalizeWalls(p:Project):Project{
  const canonical=new Map<string,Wall>(),aliases=new Map<string,string>();
  for(const raw of p.walls||[]){
    if(!raw||![raw.x1,raw.y1,raw.x2,raw.y2,raw.t,raw.h].every(Number.isFinite))continue;
    if(Math.hypot(raw.x2-raw.x1,raw.y2-raw.y1)<.08)continue;
    const key=wallKey(raw),previous=canonical.get(key);
    if(!previous){canonical.set(key,{...raw});continue}
    aliases.set(raw.id,previous.id);
    canonical.set(key,{...previous,room:undefined,t:Math.max(previous.t,raw.t),h:Math.max(previous.h,raw.h),color:previous.color||raw.color});
  }
  const items=(p.items||[]).map(item=>item.wall?{...item,wall:aliases.get(item.wall)||item.wall}:item);
  return {...p,walls:[...canonical.values()],items};
}
export function addRoom(p:Project,r:Room){const room={...r,locked:r.locked!==false};return normalizeWalls({...p,rooms:[...p.rooms,room],walls:[...p.walls,...roomWalls(room)]})}
export function changeRoom(p:Project,r:Room){const old=p.walls.filter(w=>w.room===r.id);const nw=roomWalls(r).map((w,i)=>({...w,id:old[i]?.id||w.id,t:old[i]?.t||.15,h:old[i]?.h||2.8,color:old[i]?.color||w.color}));return {...p,rooms:p.rooms.map(v=>v.id===r.id?r:v),walls:[...p.walls.filter(w=>w.room!==r.id),...nw]}}
export function nearest(p:Project,x:number,y:number){let best:any=null;for(const w of p.walls){const dx=w.x2-w.x1,dy=w.y2-w.y1,L=dx*dx+dy*dy;if(L<.01)continue;const at=Math.max(0,Math.min(1,((x-w.x1)*dx+(y-w.y1)*dy)/L)),distance=Math.hypot(x-w.x1-dx*at,y-w.y1-dy*at);if(!best||distance<best.distance)best={wall:w,at,distance}}return best as {wall:Wall,at:number,distance:number}|null}
export function position(i:Item,p:Project){const w=p.walls.find(w=>w.id===i.wall);if(!w)return i;return {...i,x:w.x1+(w.x2-w.x1)*(i.at??.5),y:w.y1+(w.y2-w.y1)*(i.at??.5),d:w.t,angle:Math.atan2(w.y2-w.y1,w.x2-w.x1)*180/Math.PI}}
export function area(rooms:Room[]){const xs=[...new Set(rooms.flatMap(r=>[r.x,r.x+r.w]))].sort((a,b)=>a-b);let sum=0;for(let i=1;i<xs.length;i++){let end=-Infinity,len=0;const ys=rooms.filter(r=>r.x<(xs[i]+xs[i-1])/2&&r.x+r.w>(xs[i]+xs[i-1])/2).map(r=>[r.y,r.y+r.d]).sort((a,b)=>a[0]-b[0]);for(const [a,b]of ys){len+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b)}sum+=(xs[i]-xs[i-1])*len}return sum}
export function sample(){let p=blank('Casa Aurora',12,12);p=addRoom(p,{id:id(),name:'Sala de estar',x:2,y:2,w:5,d:5,color:'#c7a579',material:'Madeira'});p.items=[{id:id(),name:'Sofá',kind:'sofa',x:2.45,y:2.45,w:2.6,d:.9,h:.85,angle:0,color:'#d4d0bf'},{id:id(),name:'Mesa de centro',kind:'table',x:3.2,y:4,w:1.2,d:.7,h:.38,angle:0,color:'#927257'},{id:id(),name:'Poltrona',kind:'chair',x:5.7,y:3.5,w:.8,d:.8,h:.85,angle:90,color:'#91a58e'},{id:id(),name:'Rack',kind:'cabinet',x:2.55,y:6.4,w:2.1,d:.4,h:.5,angle:0,color:'#ae8a65'},{id:id(),name:'Janela panorâmica',kind:'window',x:4.5,y:2,w:2,d:.15,h:1.3,angle:0,color:'#52636b',wall:p.walls[0].id,at:.5,sill:1},{id:id(),name:'Porta simples',kind:'door',x:7,y:5.7,w:.9,d:.15,h:2.1,angle:90,color:'#ba9671',wall:p.walls[1].id,at:.75,sill:0}];return p}
export function valid(p:any):p is Project{return p?.version===1&&typeof p.id==='string'&&typeof p.name==='string'&&p.name.length<200&&Number.isFinite(p.w)&&p.w>=2&&p.w<=100&&Number.isFinite(p.d)&&p.d>=2&&p.d<=100&&['walls','rooms','items'].every(k=>Array.isArray(p[k])&&p[k].length<2000)&&p.walls.every((v:any)=>typeof v.id==='string'&&['x1','y1','x2','y2','t','h'].every(k=>Number.isFinite(v[k]))&&v.t>0&&v.h>0)&&p.rooms.every((v:any)=>typeof v.id==='string'&&typeof v.name==='string'&&['x','y','w','d'].every(k=>Number.isFinite(v[k]))&&v.w>0&&v.d>0)&&p.items.every((v:any)=>typeof v.id==='string'&&typeof v.name==='string'&&['x','y','w','d','h','angle'].every(k=>Number.isFinite(v[k]))&&v.w>0&&v.d>0&&v.h>0)}
