// Codex character bundle. Contract: characters/ADAPTER.md.
// Generated sheets are production animation art, separate from planning mockups.
const ROOT = new URL('./', import.meta.url);
const GUESTS = ['aang','katara','toph','zuko','twilight-sparkle','pinkie-pie','fluttershy','rainbow-dash','rarity','applejack'];
const VALID = new Set(['idle','enter','hint','warmer','error','success','speak-start','speak-stop']);
let leopardPromise;
function leopardArt() {
  if (!leopardPromise) leopardPromise = fetch(new URL('art/leopard.svg', ROOT)).then(r=>{if(!r.ok)throw Error('Leopard art unavailable');return r.text();}).catch(()=>null);
  return leopardPromise;
}

export function mount(el, {character='leopard',cue='idle',reducedMotion=false}={}) {
  if (!(el instanceof Element)) return null;
  let destroyed=false, timer=null, run=0, speaking=false;
  let calm=Boolean(reducedMotion), paused=false;
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const stage=document.createElement('div');stage.className='ll-stage';stage.setAttribute('aria-hidden','true');
  const group=character==='group';
  const guest=GUESTS.includes(character)?character:null;
  stage.classList.toggle('ll-group',group);stage.classList.toggle('ll-pair',Boolean(guest));
  const actors=[];
  const createActor=(id,kind='guest')=>{
    const actor=document.createElement('div');actor.className='ll-actor ll-'+kind;actor.dataset.character=id;
    if(id==='leopard') {
      const image=document.createElement('img');image.src=new URL('art/leopard.svg',ROOT);image.alt='';image.draggable=false;actor.append(image);
      leopardArt().then(svg=>{if(svg&&!destroyed){actor.innerHTML=svg;updatePreferences();}});
    } else {
      const sprite=document.createElement('div');sprite.className='ll-sprite';sprite.style.backgroundImage=`url("${new URL('art/'+id+'-sheet.png',ROOT)}")`;
      actor.append(sprite);actors.push(sprite);
      const check=new Image();check.onload=()=>{if(!destroyed)actor.dataset.ready='true';};
      check.onerror=()=>{if(!destroyed){actor.classList.add('ll-missing');actor.replaceChildren();}};
      check.src=new URL('art/'+id+'-sheet.png',ROOT);
    }
    stage.append(actor);return actor;
  };
  createActor('leopard','main');
  if(group) ['aang','katara','toph','zuko'].forEach(id=>createActor(id));else if(guest)createActor(guest);
  const fx=document.createElement('div');fx.className='ll-fx';fx.innerHTML='<i></i><i></i><i></i><i></i><i></i>';stage.append(fx);
  el.append(stage);
  const reduced=()=>calm||media.matches;
  function clear() {run++;clearTimeout(timer);timer=null;}
  function setFrame(n) {
    const x=[0,50,100][n%3],y=n<3?0:100;
    for(const sprite of actors)sprite.style.backgroundPosition=x+'% '+y+'%';
    stage.dataset.frame=String(n);
  }
  function settle() {stage.dataset.cue='idle';setFrame(0);}
  function updatePreferences() {
    stage.classList.toggle('ll-calm',reduced());
    stage.classList.toggle('ll-speaking',speaking&&!reduced()&&!paused);
    stage.classList.toggle('ll-paused',paused);
    if(reduced()){clear();settle();}
  }
  function sequence(frames,delays,myRun) {
    let i=0;
    const tick=()=>{
      if(destroyed||paused||reduced()||myRun!==run)return;
      setFrame(frames[i]);
      if(i<frames.length-1){const wait=delays[Math.min(i,delays.length-1)];i++;timer=setTimeout(tick,wait);}
      else timer=setTimeout(()=>{if(!destroyed&&myRun===run)settle();},230);
    };tick();
  }
  function setCue(next) {
    if(destroyed)return;
    if(!VALID.has(next))next='idle';
    if(next==='speak-start'){speaking=true;paused=false;updatePreferences();return;}
    if(next==='speak-stop'){speaking=false;updatePreferences();return;}
    clear();paused=false;stage.dataset.cue=next;
    if(reduced()||next==='idle'){settle();updatePreferences();return;}
    const myRun=run;
    // Six separate poses play once; no forever-looping sprite animation.
    if(next==='success')sequence([0,1,2,3,4,5],[180,180,230,320,220],myRun);
    else if(next==='enter')sequence([0,1,5],[180,380],myRun);
    else if(next==='hint')sequence([0,1,5],[150,300],myRun);
    else if(next==='warmer')sequence([0,2,4,5],[120,200,180],myRun);
    else {setFrame(0);timer=setTimeout(()=>{if(!destroyed&&myRun===run)settle();},650);}
    updatePreferences();
  }
  function pause() {if(destroyed)return;clear();paused=true;speaking=false;settle();updatePreferences();}
  function visibility(){if(document.hidden)pause();}
  const change=()=>updatePreferences();
  if(media.addEventListener)media.addEventListener('change',change);else media.addListener(change);
  document.addEventListener('visibilitychange',visibility);
  function destroy() {
    if(destroyed)return;destroyed=true;clear();
    document.removeEventListener('visibilitychange',visibility);
    if(media.removeEventListener)media.removeEventListener('change',change);else media.removeListener(change);
    stage.remove();el.removeAttribute('data-mounted');
  }
  updatePreferences();setCue(cue);
  return {setCue,setReducedMotion(value){calm=Boolean(value);updatePreferences();},pause,destroy};
}
export default {mount};
