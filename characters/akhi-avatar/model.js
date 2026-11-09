// Akhila, soft collectible-doll edition. Original articulated mesh character.
// Style reference: Sahith's November 8 image. Y up, +Z forward.
import * as T from './vendor/three.module.min.js';
export { T };

function knitTexture() {
  const c=document.createElement('canvas');c.width=c.height=128;
  const x=c.getContext('2d');x.fillStyle='#aaa';x.fillRect(0,0,128,128);
  x.lineWidth=1.5;x.strokeStyle='#c3c3c3';
  for(let i=0;i<128;i+=8)for(let j=-10;j<128;j+=10){x.beginPath();x.moveTo(i+1,j);x.lineTo(i+4,j+7);x.lineTo(i+7,j);x.stroke();}
  const tx=new T.CanvasTexture(c);tx.wrapS=tx.wrapT=T.RepeatWrapping;tx.repeat.set(7,2);return tx;
}
function beanieLogo(){
  const c=document.createElement('canvas');c.width=384;c.height=256;const x=c.getContext('2d');x.fillStyle='#34312d';
  for(const [dx,a]of[[-55,-.58],[0,0],[55,.58]]){x.save();x.translate(192+dx,86);x.rotate(a);x.beginPath();x.moveTo(0,-64);x.bezierCurveTo(-45,-10,-35,34,0,48);x.bezierCurveTo(35,34,45,-10,0,-64);x.fill();x.restore();}
  x.globalCompositeOperation='destination-out';for(const y of[83,102,121])x.fillRect(80,y,224,7);
  x.globalCompositeOperation='source-over';x.font='bold 60px Arial';x.textAlign='center';x.fillText('adidas',192,202);
  const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;return tx;
}
function blushTexture(){
  const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),g=x.createRadialGradient(32,32,1,32,32,31);
  g.addColorStop(0,'rgba(221,113,115,.46)');g.addColorStop(.45,'rgba(214,107,107,.25)');g.addColorStop(1,'rgba(214,107,107,0)');x.fillStyle=g;x.fillRect(0,0,64,64);
  const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;return tx;
}

export function createAkhiModel(){
  const root=new T.Group();root.name='Akhila-soft-doll';const rig=new T.Group();rig.position.y=-.13;root.add(rig);
  const knit=knitTexture();
  const soft=(color,roughness=.72,extra={})=>new T.MeshPhysicalMaterial({color,roughness,metalness:0,clearcoat:.08,clearcoatRoughness:.65,...extra});
  const m={
    skin:soft('#A46C50',.72),ear:soft('#AC6B57',.8),hair:soft('#292024',.60,{clearcoat:.20,clearcoatRoughness:.45}),hairLight:soft('#37292C',.65),
    hoodie:soft('#4B4C53',.88),rib:soft('#45464D',.9,{bumpMap:knit,bumpScale:.008}),seam:soft('#61616A',.86),denim:soft('#303138',.92),
    shoe:soft('#F7F4EE',.68),sole:soft('#DEDFDB',.88),lace:soft('#FCF9F1',.8),hat:soft('#DDBB8F',.86,{bumpMap:knit,bumpScale:.009}),
    hatRib:soft('#D7B486',.9,{bumpMap:knit,bumpScale:.012}),ink:soft('#39262B',.7),lip:soft('#8B4145',.7),white:soft('#FFF8F0',.28),
    pupil:new T.MeshBasicMaterial({color:'#21131B',toneMapped:false}),glint:new T.MeshBasicMaterial({color:'#FFF9ED'}),
  };
  const sphere=new T.SphereGeometry(1,32,24);
  function ell(parent,mat,pos,scale,geo=sphere){const mesh=new T.Mesh(geo,mat);mesh.position.set(...pos);mesh.scale.set(...scale);parent.add(mesh);return mesh;}
  function roundedGeo(power=.77){
    const g=new T.SphereGeometry(1,40,28),p=g.attributes.position;
    const f=n=>Math.sign(n)*Math.pow(Math.abs(n),power);
    for(let i=0;i<p.count;i++)p.setXYZ(i,f(p.getX(i)),f(p.getY(i)),f(p.getZ(i)));
    g.computeVertexNormals();return g;
  }
  function tube(parent,mat,points,r=.012,segments=24){
    const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));const geo=new T.TubeGeometry(curve,segments,r,10,false);
    const mesh=new T.Mesh(geo,mat);parent.add(mesh);return mesh;
  }
  function profile(parent,mat,points,scale=[1,1,1],pos=[0,0,0]){
    const curve=new T.CatmullRomCurve3(points.map(([r,y])=>new T.Vector3(r,y,0)));
    return ell(parent,mat,pos,scale,new T.LatheGeometry(curve.getPoints(points.length*5).map(p=>new T.Vector2(Math.max(0,p.x),p.y)),48));
  }
  // Broad, softly flattened wave sections read as sculpted hair rather than strings.
  function strand(parent,mat,points,width=.13,depth=.065,segments=40){
    const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),g=new T.TubeGeometry(curve,segments,width,12,false),p=g.attributes.position;
    for(let i=0;i<=segments;i++){
      const c=curve.getPointAt(i/segments),t=i/segments,f=.98-.92*Math.pow(t,6);
      for(let j=0;j<=12;j++){const n=i*13+j;p.setXYZ(n,c.x+(p.getX(n)-c.x)*f,c.y+(p.getY(n)-c.y)*f,c.z+(p.getZ(n)-c.z)*f*depth/width);}
    }
    g.computeVertexNormals();
    const n=g.attributes.normal;
    for(let i=0;i<=segments;i++){const a=i*13,b=a+12,v=new T.Vector3().fromBufferAttribute(n,a).add(new T.Vector3().fromBufferAttribute(n,b)).normalize();n.setXYZ(a,v.x,v.y,v.z);n.setXYZ(b,v.x,v.y,v.z);}
    const mesh=new T.Mesh(g,mat);parent.add(mesh);return mesh;
  }

  // Shorter body, larger rounded head, and pillowy clothing like the supplied toy reference.
  const legs=[],arms=[],sideLocks=[],eyes=[];
  for(const side of[-1,1]){
    const leg=new T.Group();leg.position.set(side*.24,1.02,0);rig.add(leg);legs.push(leg);
    ell(leg,m.denim,[0,-.30,0],[.235,.405,.235],roundedGeo(.62));
    const foot=new T.Group();foot.position.set(0,-.77,.07);leg.add(foot);
    ell(foot,m.sole,[0,-.035,.08],[.252,.085,.375],roundedGeo(.66));
    ell(foot,m.shoe,[0,.065,.07],[.237,.145,.348],roundedGeo(.72));
    ell(foot,m.shoe,[0,.13,-.10],[.205,.17,.16],roundedGeo(.78));
    // Actual raised white laces and subtle sneaker seams.
    for(let j=0;j<4;j++){const z=.045+j*.055,y=.242-j*.012;tube(foot,m.lace,[[-.105,y,z],[0,y+.014,z+.018],[.105,y,z]],.011,10);}
    tube(foot,m.sole,[[-.19,.058,.23],[0,.079,.36],[.19,.058,.23]],.006,16);
  }
  ell(rig,m.hoodie,[0,1.35,.01],[.55,.48,.36],roundedGeo(.72));
  ell(rig,m.rib,[0,.96,.012],[.505,.085,.344],roundedGeo(.64));
  // Sculpted soft hood, opening behind the neck.
  ell(rig,m.hoodie,[0,1.76,-.12],[.49,.24,.33]);
  tube(rig,m.rib,[[-.32,1.83,.13],[-.20,1.69,.29],[0,1.66,.32],[.20,1.69,.29],[.32,1.83,.13]],.055,32);
  for(const side of[-1,1]){
    tube(rig,m.seam,[[side*.135,1.73,.29],[side*.16,1.55,.377],[side*.15,1.43,.38]],.014,20);
    ell(rig,m.rib,[side*.15,1.40,.38],[.022,.038,.021]);
  }
  // A shallow fabric patch, with curved edges instead of a raised oval pocket.
  const pocket=new T.Shape();pocket.moveTo(-.34,-.14);pocket.quadraticCurveTo(-.37,-.01,-.25,.15);pocket.quadraticCurveTo(0,.18,.25,.15);pocket.quadraticCurveTo(.37,-.01,.34,-.14);pocket.quadraticCurveTo(0,-.18,-.34,-.14);
  const patch=new T.Mesh(new T.ShapeGeometry(pocket,20),m.hoodie);patch.position.set(0,1.18,.369);rig.add(patch);
  tube(rig,m.seam,[[-.33,1.055,.377],[0,1.02,.382],[.33,1.055,.377]],.005,28);
  for(const side of[-1,1])tube(rig,m.seam,[[side*.34,1.09,.378],[side*.30,1.24,.378],[side*.24,1.32,.375]],.006,20);
  for(const side of[-1,1]){
    const arm=new T.Group();arm.position.set(side*.48,1.68,.01);rig.add(arm);arms.push(arm);
    ell(arm,m.hoodie,[side*.015,-.27,.06],[.24,.36,.25]);
    ell(arm,m.rib,[0,-.49,.14],[.17,.092,.18],roundedGeo(.78));
    ell(arm,m.skin,[0,-.565,.16],[.102,.105,.09]);
    ell(arm,m.skin,[side*-.075,-.54,.215],[.044,.061,.04]);
  }
  ell(rig,m.skin,[0,1.83,.04],[.17,.16,.15]);

  const head=new T.Group();head.position.y=2.42;rig.add(head);
  const hair=new T.Group();head.add(hair);
  ell(hair,m.hair,[0,-.48,-.19],[.78,.94,.37]);
  ell(hair,m.hair,[0,.17,-.08],[.83,.75,.62]);
  for(let i=0;i<9;i++){
    const x=(i-4)*.15,points=[];
    for(let j=0;j<=10;j++){const t=j/10;points.push([x+Math.sin(t*8+i*.4)*.045,.30-t*1.73,-.41-.22*Math.sin(Math.PI*t)]);}
    strand(hair,i%3===0?m.hairLight:m.hair,points,.13,.07,40);
  }
  // Soft square-oval cheeks. No jaw seam or protruding eyeball rims.
  const faceGeo=roundedGeo(.94);ell(head,m.skin,[0,-.005,.07],[.77,.68,.57],faceGeo);
  const blush=new T.MeshBasicMaterial({map:blushTexture(),transparent:true,depthWrite:false,toneMapped:false});
  for(const side of[-1,1]){
    ell(head,m.skin,[side*.758,-.10,.08],[.13,.17,.12]);
    ell(head,m.ear,[side*.802,-.10,.155],[.045,.079,.025]);
    const cheek=new T.Mesh(new T.PlaneGeometry(.32,.18),blush);cheek.position.set(side*.46,-.245,.586);cheek.rotation.y=side*.30;head.add(cheek);
    const eye=new T.Group();eye.position.set(side*.275,-.045,.617);eye.rotation.y=side*.13;head.add(eye);eyes.push(eye);
    ell(eye,m.white,[0,0,0],[.205,.234,.032]);
    const irisGeo=new T.SphereGeometry(1,32,24),colors=[],q=irisGeo.attributes.position;
    const dark=new T.Color('#2C1928'),warm=new T.Color('#9C6349');
    for(let i=0;i<q.count;i++){const f=T.MathUtils.clamp((.65-q.getY(i))*.63,0,1),color=dark.clone().lerp(warm,f);colors.push(color.r,color.g,color.b);}
    irisGeo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    const iris=new T.MeshPhysicalMaterial({color:0xffffff,vertexColors:true,roughness:.22,clearcoat:1,clearcoatRoughness:.12});
    ell(eye,iris,[side*-.014,-.006,.030],[.167,.209,.017],irisGeo);
    ell(eye,m.pupil,[side*-.014,.035,.045],[.105,.149,.010]);
    ell(eye,m.glint,[-.047,.103,.061],[.030,.039,.006]);
    ell(eye,m.glint,[.061,-.106,.055],[.010,.014,.004]);
    tube(eye,m.ink,[[-.198,.075,.005],[-.13,.20,.015],[0,.234,.015],[.13,.20,.014],[.198,.075,.005]],.014,28);
    for(let j=0;j<3;j++)tube(eye,m.ink,[[side*(.15+j*.016),.145-j*.035,.01],[side*(.205+j*.025),.193-j*.037,.009]],.011,8);
    tube(head,m.hairLight,[[side*.13,.286,.606],[side*.25,.31,.596],[side*.37,.29,.57]],.019,24);
  }
  ell(head,m.skin,[0,-.19,.657],[.036,.037,.025]);
  tube(head,m.lip,[[-.095,-.345,.621],[-.05,-.369,.631],[0,-.378,.635],[.05,-.369,.631],[.095,-.345,.621]],.011,32);

  // Long, flattened S-waves and an asymmetrical soft fringe under her beanie.
  for(const side of[-1,1]){
    const lock=new T.Group();hair.add(lock);sideLocks.push(lock);
    strand(lock,m.hair,[[side*.50,.54,.23],[side*.72,.25,.40],[side*.76,-.07,.37],[side*.84,-.40,.31],[side*.76,-.73,.33],[side*.83,-1.02,.27],[side*.70,-1.35,.22]],.16,.085,56);
    strand(lock,m.hairLight,[[side*.73,.11,.48],[side*.77,-.24,.43],[side*.79,-.48,.42],[side*.72,-.72,.44],[side*.78,-1.01,.35],[side*.69,-1.30,.28]],.033,.014,48);
    strand(lock,m.hair,[[side*.76,.24,.05],[side*.87,-.12,.08],[side*.91,-.47,.02],[side*.84,-.81,.09],[side*.89,-1.14,.01],[side*.76,-1.42,0]],.13,.075,48);
  }
  strand(hair,m.hairLight,[[-.43,.55,.27],[-.30,.52,.56],[-.08,.40,.625],[.18,.36,.62],[.35,.39,.55]],.115,.055,40);
  strand(hair,m.hair,[[-.49,.52,.28],[-.62,.33,.51],[-.67,.15,.48],[-.72,.08,.40]],.115,.055,32);

  // Roots start inside the beanie cavity and turn forward below its folded edge.
  // Two short face-framing ringlets escape from under the beanie at her temples.
  const templeCurls=[];
  for(const side of[-1,1]){
    const curl=new T.Group();curl.name=side<0?'temple-curl-left':'temple-curl-right';hair.add(curl);templeCurls.push(curl);
    const points=[[side*.59,.50,.39],[side*.585,.415,.40],[side*.565,.36,.605],[side*.60,.22,.64],[side*.585,.09,.657],[side*.535,.005,.66],[side*.54,-.095,.657],[side*.605,-.12,.65],[side*.635,-.058,.635],[side*.60,-.027,.635]];
    strand(curl,m.hair,points,.045,.032,56);
    strand(curl,m.hairLight,points.slice(1).map(([x,y,z])=>[x-side*.009,y,z+.027]),.009,.005,48);
  }

  // Rounded knitted beanie. Preserve the supplied beige outfit rather than copying the reference colors.
  ell(head,m.hat,[0,.50,0],[1,.73,.86],new T.SphereGeometry(.83,48,32,0,Math.PI*2,0,Math.PI/2));
  profile(head,m.hatRib,[[.765,.405],[.824,.415],[.855,.46],[.86,.56],[.845,.645],[.80,.668],[.765,.65]],[1,1,.86]);
  const logo=new T.Mesh(new T.PlaneGeometry(.22,.146),new T.MeshBasicMaterial({map:beanieLogo(),transparent:true,depthWrite:false,toneMapped:false}));logo.position.set(0,.54,.751);head.add(logo);

  const restY=rig.position.y;
  function pose(t,{walking=false,running=false,arrival=0,calm=false,yaw=.15}={}){
    const sprint=running&&!calm,beat=t*(sprint?12.4:7.2),gait=(walking||running)&&!calm?1:0;
    root.rotation.y=yaw;rig.position.y=restY+(calm?0:Math.sin(t*1.65)*.009+Math.abs(Math.sin(beat))*(sprint ? .065 : .027)*gait);
    rig.rotation.x=sprint ? .12 : 0;
    rig.rotation.z=calm?0:Math.sin(t*1.1)*.009+Math.sin(beat)*(sprint ? .026 : .015)*gait;
    legs[0].rotation.x=Math.sin(beat)*(sprint ? .55 : .30)*gait;legs[1].rotation.x=-Math.sin(beat)*(sprint ? .55 : .30)*gait;
    arms[0].rotation.x=-Math.sin(beat)*(sprint ? .47 : .22)*gait;arms[1].rotation.x=Math.sin(beat)*(sprint ? .47 : .22)*gait;
    arms[0].rotation.z=.12;arms[1].rotation.z=-.12;
    if(!calm&&arrival>0&&arrival<2.3){const fade=Math.min(1,arrival*5,(2.3-arrival)*4);arms[1].rotation.z=-.12+(2.3+Math.sin(arrival*13)*.12)*fade;arms[1].rotation.x=-.38*fade;arms[1].position.z=.01+.25*fade;}else arms[1].position.z=.01;
    head.rotation.x=sprint ? -.055 : 0;
    head.rotation.z=calm?0:Math.sin(t*1.05)*.014;
    sideLocks.forEach((lock,i)=>lock.rotation.z=calm?0:Math.sin(t*1.5+i)*.010+Math.sin(beat+i)*(sprint ? .032 : .013)*gait);
    templeCurls.forEach((curl,i)=>curl.rotation.z=calm?0:Math.sin(t*1.6+i)*.007+Math.sin(beat+i)*(sprint ? .018 : .009)*gait);
    const blink=!calm&&t%5.7>5.52?Math.max(.08,Math.abs((t%5.7-5.61)/.09)):1;eyes.forEach(eye=>eye.scale.y=blink);
  }
  root.traverse(o=>{if(o.isMesh){o.castShadow=!o.material.transparent;o.receiveShadow=!o.material.transparent;}});
  pose(0,{calm:true});
  function dispose(){
    const gs=new Set(),ms=new Set(),txs=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(mat=>{ms.add(mat);for(const v of Object.values(mat))if(v?.isTexture)txs.add(v);});});
    gs.forEach(g=>g.dispose());ms.forEach(mat=>mat.dispose());txs.forEach(tx=>tx.dispose());
  }
  return{root,pose,dispose,rig,head,arms,legs,templeCurls};
}
