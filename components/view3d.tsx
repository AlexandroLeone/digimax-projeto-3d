'use client';
import {useEffect,useRef,useState} from 'react';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {SVGRenderer} from 'three/addons/renderers/SVGRenderer.js';
import {Project} from '@/lib/model';
import {model,dispose} from '@/lib/scene';

function webglAvailable(){
  try{
    const canvas=document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2')||canvas.getContext('webgl'));
  }catch{return false;}
}

export default function View3D({p,view='perspective',ceil=false,cut=false,furniture3D=false,tools=false,onPick}:{p:Project,view?:string,ceil?:boolean,cut?:boolean,furniture3D?:boolean,tools?:boolean,onPick?:(id:string)=>void}){
  const el=useRef<HTMLDivElement>(null),api=useRef<any>(null);
  const[error,setError]=useState('');
  const[importError,setImportError]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    if(!el.current)return;
    const host=el.current;
    let renderer:any;
    let software=false;
    try{
      if(!webglAvailable())throw new Error('WebGL indisponível');
      renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:false});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
      renderer.shadowMap.enabled=true;
      renderer.shadowMap.type=T.PCFSoftShadowMap;
      renderer.setClearColor('#edf0f1');
    }catch{
      software=true;
      renderer=new SVGRenderer();
      renderer.setQuality('high');
      renderer.setClearColor(new T.Color('#edf0f1'),1);
      setError('Modo compatibilidade 3D ativo');
    }
    host.appendChild(renderer.domElement);
    const scene=new T.Scene();
    const camera=new T.PerspectiveCamera(42,1,.03,500);
    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;
    controls.dampingFactor=.08;
    controls.maxPolarAngle=Math.PI*.49;
    scene.add(new T.HemisphereLight('#ffffff','#78928b',2.4));
    const sun=new T.DirectionalLight('#fff8e9',3);
    sun.position.set(-4,16,8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-25,right:25,top:25,bottom:-25});scene.add(sun);
    if(software){sun.intensity=.65;scene.add(new T.AmbientLight(0xffffff,.7));}
    const ground=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshLambertMaterial({color:'#f2f4f4'}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-.09;ground.receiveShadow=true;
    if(!software)scene.add(ground);
    const grid=new T.GridHelper(100,200,'#cfdadd','#dce4e6');grid.position.y=-.085;scene.add(grid);
    api.current={scene,camera,controls,renderer,software,dirty:true};
    controls.addEventListener('change',()=>{if(api.current)api.current.dirty=true});
    const resize=()=>{const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);if(api.current)api.current.dirty=true;};
    const observer=new ResizeObserver(resize);observer.observe(host);resize();
    let frame=0;
    const render=()=>{controls.update();if(api.current?.dirty){renderer.render(scene,camera);api.current.dirty=false}frame=requestAnimationFrame(render);};
    render();
    const key=(e:KeyboardEvent)=>{if(['INPUT','SELECT','TEXTAREA'].includes((e.target as HTMLElement)?.tagName))return;if(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();move(e.key);}};
    window.addEventListener('keydown',key);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('keydown',key);controls.dispose();dispose(scene);renderer.dispose?.();renderer.domElement.remove();api.current=null;};
  },[]);
  useEffect(()=>{
    const a=api.current;if(!a)return;
    const m=model(p,ceil,cut,furniture3D);
    if(a.software)m.traverse((o:any)=>{if(o.material){const old=o.material;o.material=new T.MeshLambertMaterial({color:old.color||new T.Color('#c9cfcc'),transparent:old.transparent,opacity:old.opacity});old.dispose();}});
    a.scene.add(m);a.dirty=true;
    return()=>{a.scene.remove(m);dispose(m);};
  },[p,ceil,cut,furniture3D]);
  useEffect(()=>{
    const a=api.current;if(!a)return;
    const r=p.rooms[0];
    const x=r?r.x+r.w/2:p.w/2,z=r?r.y+r.d/2:p.d/2;
    const extent=Math.max(6,...p.rooms.map(r=>Math.max(r.w,r.d)));
    if(view==='walk'){a.camera.position.set(x,1.65,z);a.controls.target.set(x,1.65,z-2);a.controls.maxPolarAngle=Math.PI*.95;}
    else if(view==='top'){a.camera.position.set(x,extent*2.4,z+.01);a.controls.target.set(x,0,z);a.controls.maxPolarAngle=Math.PI*.49;}
    else{a.camera.position.set(x+extent*.9,extent*1.15,z+extent*1.4);a.controls.target.set(x,.7,z);a.controls.maxPolarAngle=Math.PI*.49;}
    a.controls.update();a.dirty=true;
  },[view,p.id,p.rooms.length,p.walls.length,p.items.length]);
  function move(key:string){const a=api.current;if(!a)return;const v=new T.Vector3();a.camera.getWorldDirection(v);v.y=0;v.normalize();if(['a','ArrowLeft'].includes(key))v.cross(new T.Vector3(0,1,0)).multiplyScalar(-1);if(['d','ArrowRight'].includes(key))v.cross(new T.Vector3(0,1,0));if(['s','ArrowDown'].includes(key))v.multiplyScalar(-1);v.multiplyScalar(.28);a.camera.position.add(v);a.controls.target.add(v);a.dirty=true;}
  async function importModel(file:File){
    setImportError('');
    const ext=file.name.toLowerCase().split('.').pop();
    if(ext==='skp'){setImportError('O SketchUp .skp precisa ser exportado como GLB/GLTF para abrir no navegador.');return}
    if(!['glb','gltf'].includes(ext||'')){setImportError('Use um modelo GLB ou GLTF exportado do SketchUp.');return}
    const a=api.current;if(!a)return;
    const url=URL.createObjectURL(file);
    try{const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');const gltf=await new GLTFLoader().loadAsync(url);const root=gltf.scene;root.name=file.name;root.userData.importedModel=true;root.traverse((o:any)=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});const box3=new T.Box3().setFromObject(root);const size=box3.getSize(new T.Vector3());const max=Math.max(size.x,size.y,size.z)||1;root.scale.setScalar(Math.min(3,Math.max(.25,3/max)));root.position.set(p.w/2,0,p.d/2);a.scene.add(root);(a.importedModels??=[]).push(root);a.dirty=true;setImportError(`Modelo ${file.name} carregado no projeto 3D.`)}catch{setImportError('Não foi possível abrir este arquivo. Exporte novamente como GLB/GLTF no SketchUp.')}finally{URL.revokeObjectURL(url)}
  }
  return <div className="three"><div className="three-host" ref={el}/>{tools&&<div className="three-model-tools"><button onClick={()=>fileInput.current?.click()}><span>＋</span> Importar modelo 3D</button><input ref={fileInput} type="file" hidden accept=".glb,.gltf,.skp" onChange={e=>{const f=e.target.files?.[0];if(f)importModel(f);e.target.value='' }}/><small>SketchUp: exporte como GLB/GLTF</small></div>}{error&&<div className="webgl-status" role="status" aria-live="polite"><span aria-hidden="true">●</span>{error}</div>}{importError&&<div className="webgl-status model-status" role="status" aria-live="polite"><span aria-hidden="true">●</span>{importError}</div>}{view==='walk'&&<div className="walk-pad"><span>Arraste para olhar • WASD para andar</span><div>{[['a','←'],['w','↑'],['s','↓'],['d','→']].map(([key,label])=><button key={key} onClick={()=>move(key)} aria-label={'Andar '+label}>{label}</button>)}</div></div>}</div>;
}
