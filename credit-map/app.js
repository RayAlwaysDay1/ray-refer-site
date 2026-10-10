(() => {
  const STAGES = {
    infra: ['基建', '#7dd3fc'], icebreak: ['破冰', '#86efac'], amex: ['Amex', '#fcd34d'],
    chase: ['Chase', '#93c5fd'], flagship: ['旗舰', '#f9a8d4'], monitor: ['监控', '#c4b5fd'], side: ['旁路', '#fdba74']
  };
  const KINDS = {
    requires: ['依赖', '#7dd3fc'], next: ['顺序', '#86efac'], optional: ['可选', '#fdba74'],
    blocks: ['阻断', '#fb7185'], monitors: ['监控', '#c4b5fd'], stacks: ['叠加', '#fcd34d']
  };
  const PATHS = { p1: '路径一', p2: '路径二', p3: '路径三', p4: '路径四', p5: '路径五' };
  const stageOrder = Object.keys(STAGES), kindOrder = Object.keys(KINDS);
  const canvas = document.querySelector('#graph'), ctx = canvas.getContext('2d');
  const wrap = document.querySelector('#graph-wrap'), detail = document.querySelector('#detail');
  const state = { data: null, nodes: [], edges: [], selected: null, hovered: null, hoveredEdge: null, drag: null, activePath: null, stages: new Set(stageOrder), kinds: new Set(kindOrder), scale: 1, tx: 0, ty: 0, width: 0, height: 0, dirty: true, running: true };

  const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const sourceId = e => typeof e.source === 'object' ? e.source.id : e.source;
  const targetId = e => typeof e.target === 'object' ? e.target.id : e.target;
  const stageColor = stage => STAGES[stage]?.[1] || '#e7ecf3';

  function initControls() {
    const stageBox = document.querySelector('#stage-filters');
    stageBox.innerHTML = stageOrder.map(key => `<button class="check" type="button" data-stage="${key}" aria-pressed="true"><span>${STAGES[key][0]}</span><i class="dot" style="--c:${STAGES[key][1]}"></i></button>`).join('');
    const edgeBox = document.querySelector('#edge-filters');
    edgeBox.innerHTML = kindOrder.map(key => `<button class="check" type="button" data-kind="${key}" aria-pressed="true"><span>${KINDS[key][0]}</span><i class="dot" style="--c:${KINDS[key][1]}"></i></button>`).join('');
    document.querySelector('#path-filters').innerHTML = Object.entries(PATHS).map(([key,label]) => `<button class="path" type="button" data-path="${key}" aria-pressed="false">${label}</button>`).join('');
    document.querySelector('#legend').insertAdjacentHTML('beforeend', kindOrder.map(key => `<div class="legend-row"><i class="legend-line ${key==='optional'?'dash':key==='monitors'?'dotline':key==='stacks'?'double':''}" style="--lc:${KINDS[key][1]}"></i><span>${KINDS[key][0]}</span></div>`).join(''));

    stageBox.addEventListener('click', e => { const b=e.target.closest('[data-stage]'); if(!b)return; const k=b.dataset.stage; state.stages.has(k)?state.stages.delete(k):state.stages.add(k); b.setAttribute('aria-pressed',state.stages.has(k)); applyFilters(); });
    edgeBox.addEventListener('click', e => { const b=e.target.closest('[data-kind]'); if(!b)return; const k=b.dataset.kind; state.kinds.has(k)?state.kinds.delete(k):state.kinds.add(k); b.setAttribute('aria-pressed',state.kinds.has(k)); applyFilters(); });
    document.querySelector('#path-filters').addEventListener('click', e => { const b=e.target.closest('[data-path]'); if(!b)return; state.activePath=state.activePath===b.dataset.path?null:b.dataset.path; document.querySelectorAll('[data-path]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.path===state.activePath)); applyFilters(true); });
    document.querySelector('#reset-filters').onclick = () => { state.activePath=null; state.stages=new Set(stageOrder); state.kinds=new Set(kindOrder); document.querySelectorAll('[data-stage],[data-kind]').forEach(x=>x.setAttribute('aria-pressed','true')); document.querySelectorAll('[data-path]').forEach(x=>x.setAttribute('aria-pressed','false')); applyFilters(true); };
    document.querySelector('#fit').onclick = fit;
    document.querySelector('#legend-toggle').onclick = e => { const hidden=!document.querySelector('#legend').hidden; document.querySelector('#legend').hidden=hidden; e.currentTarget.setAttribute('aria-pressed',String(!hidden)); };
    document.querySelector('#close-detail').onclick = () => selectNode(null);
  }

  function basePathNodes(path) {
    const ids = new Set(['cloud-resident','address','phone','itin','repay','c1','five24']);
    state.data.nodes.forEach(n => { if (n.paths?.includes(path)) ids.add(n.id); });
    state.data.edges.forEach(e => { if (e.paths?.includes(path)) { ids.add(sourceId(e)); ids.add(targetId(e)); } });
    return ids;
  }
  function applyFilters(refit=false) {
    const pathIds = state.activePath ? basePathNodes(state.activePath) : null;
    state.nodes = state.data.nodes.filter(n => state.stages.has(n.stage) && (!pathIds || pathIds.has(n.id)));
    const ids = new Set(state.nodes.map(n=>n.id));
    state.edges = state.data.edges.filter(e => state.kinds.has(e.kind) && ids.has(sourceId(e)) && ids.has(targetId(e)) && (!state.activePath || !e.paths || e.paths.includes(state.activePath) || ['requires','blocks','monitors'].includes(e.kind)));
    document.querySelector('#graph-status').textContent = `${state.nodes.length} 节点 · ${state.edges.length} 关系${state.activePath ? ' · '+PATHS[state.activePath] : ''}`;
    if (state.selected && !ids.has(state.selected.id)) selectNode(null);
    state.running=false; state.dirty=true; if(refit) setTimeout(()=>{fit();draw();},40);
  }

  function seedPositions() {
    const columns={infra:0,icebreak:1,amex:2,chase:3,flagship:4};
    const groups={}; state.data.nodes.forEach(n=>(groups[n.stage]??=[]).push(n));
    Object.entries(groups).forEach(([stage,nodes])=>nodes.forEach((n,i)=>{
      if(stage==='monitor'){n.x=500+i*230;n.y=430;}
      else if(stage==='side'){n.x=40+(i%4)*275;n.y=i<4?-430:610;}
      else {n.x=(columns[stage]||0)*260;n.y=(i-(nodes.length-1)/2)*112;}
      n.targetY=n.y;n.vx=0;n.vy=0;
    }));
  }

  function simulate() {
    if (!state.running) return;
    const nodes=state.nodes, edges=state.edges, count=nodes.length;
    for(let i=0;i<count;i++) for(let j=i+1;j<count;j++){
      const a=nodes[i],b=nodes[j],dx=b.x-a.x,dy=b.y-a.y,d2=Math.max(1200,dx*dx+dy*dy),d=Math.sqrt(d2),f=2100/d2;
      a.vx-=dx/d*f;a.vy-=dy/d*f;b.vx+=dx/d*f;b.vy+=dy/d*f;
    }
    edges.forEach(e=>{const a=state.data.nodeMap.get(sourceId(e)),b=state.data.nodeMap.get(targetId(e));if(!a||!b)return;const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),want=e.kind==='monitors'?190:165,f=(d-want)*.0018;a.vx+=dx*f;b.vx-=dx*f;a.vy+=dy*f;b.vy-=dy*f;});
    nodes.forEach(n=>{const stageX=({infra:-380,icebreak:-140,amex:80,chase:300,flagship:520,monitor:300,side:80}[n.stage]||0);n.vx+=(stageX-n.x)*.002;n.vy+=((n.targetY||0)-n.y)*.0022;n.vx*=.82;n.vy*=.82;if(state.drag!==n){n.x+=n.vx;n.y+=n.vy;}});
    state.dirty=true;
    const energy=nodes.reduce((s,n)=>s+Math.abs(n.vx)+Math.abs(n.vy),0); if(energy<.08) state.running=false;
  }

  function resize() { const r=wrap.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);state.width=r.width;state.height=r.height;canvas.width=r.width*dpr;canvas.height=r.height*dpr;canvas.style.width=r.width+'px';canvas.style.height=r.height+'px';ctx.setTransform(dpr,0,0,dpr,0,0);state.dirty=true; }
  function worldToScreen(n){return{x:n.x*state.scale+state.tx+state.width/2,y:n.y*state.scale+state.ty+state.height/2}}
  function screenToWorld(x,y){return{x:(x-state.tx-state.width/2)/state.scale,y:(y-state.ty-state.height/2)/state.scale}}
  function roundedRect(x,y,w,h,r){
    const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.lineTo(x+w-rr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+rr);ctx.lineTo(x+w,y+h-rr);ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);ctx.lineTo(x+rr,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-rr);ctx.lineTo(x,y+rr);ctx.quadraticCurveTo(x,y,x+rr,y);ctx.closePath();
  }
  function connected(id){const s=new Set([id]);state.edges.forEach(e=>{if(sourceId(e)===id)s.add(targetId(e));if(targetId(e)===id)s.add(sourceId(e));});return s}

  function draw() {
    ctx.clearRect(0,0,state.width,state.height);
    const focus=state.selected?connected(state.selected.id):null;
    ctx.save();ctx.translate(state.width/2+state.tx,state.height/2+state.ty);ctx.scale(state.scale,state.scale);
    state.hoveredEdge=null;
    state.edges.forEach(e=>{const a=state.data.nodeMap.get(sourceId(e)),b=state.data.nodeMap.get(targetId(e));if(!a||!b)return;const faded=focus&&!focus.has(a.id)&&!focus.has(b.id);ctx.globalAlpha=faded?.18:.68;ctx.strokeStyle=KINDS[e.kind][1];ctx.fillStyle=KINDS[e.kind][1];ctx.lineWidth=(e.kind==='blocks'?2.2:1.3)/state.scale;ctx.setLineDash(e.kind==='optional'?[7/state.scale,5/state.scale]:e.kind==='monitors'?[2/state.scale,5/state.scale]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);if(['next','requires','blocks'].includes(e.kind)){const ang=Math.atan2(b.y-a.y,b.x-a.x),len=8/state.scale,px=b.x-Math.cos(ang)*55,py=b.y-Math.sin(ang)*18;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-Math.cos(ang-.55)*len,py-Math.sin(ang-.55)*len);ctx.lineTo(px-Math.cos(ang+.55)*len,py-Math.sin(ang+.55)*len);ctx.closePath();ctx.fill();}if(e.kind==='stacks'){ctx.beginPath();ctx.moveTo(a.x,a.y+4/state.scale);ctx.lineTo(b.x,b.y+4/state.scale);ctx.stroke();}});
    state.nodes.forEach(n=>{const w=Math.max(118,Math.min(190,n.title.length*15+42)),h=46;n._w=w;n._h=h;const faded=(focus&&!focus.has(n.id))||n._match===false;ctx.globalAlpha=faded?.2:1;ctx.shadowColor=stageColor(n.stage);ctx.shadowBlur=(state.selected===n?20:state.hovered===n?12:0)/state.scale;roundedRect(n.x-w/2,n.y-h/2,w,h,9);ctx.fillStyle='#172131';ctx.fill();ctx.lineWidth=(state.selected===n?3:state.hovered===n?2:1.25)/state.scale;ctx.strokeStyle=stageColor(n.stage);ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='#e7ecf3';ctx.font=`700 ${Math.max(11,14/state.scale)}px Inter, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(n.title,n.x,n.y);if(['infra','icebreak','amex','chase','flagship'].includes(n.stage)){ctx.fillStyle=stageColor(n.stage);ctx.fillRect(n.x-w/2,n.y-h/2,5/state.scale,h);}});
    ctx.restore();ctx.globalAlpha=1;
    if(state.hoveredEdge){ const e=state.hoveredEdge; }
  }
  function frame(){if(state.running)simulate();if(state.dirty){draw();state.dirty=false}}

  function findNode(sx,sy){const p=screenToWorld(sx,sy);for(let i=state.nodes.length-1;i>=0;i--){const n=state.nodes[i];if(Math.abs(p.x-n.x)<=n._w/2+8&&Math.abs(p.y-n.y)<=n._h/2+8)return n;}return null}
  function findEdge(sx,sy){const p=screenToWorld(sx,sy);let best=null,bestD=12/state.scale;state.edges.forEach(e=>{const a=state.data.nodeMap.get(sourceId(e)),b=state.data.nodeMap.get(targetId(e));const l2=(b.x-a.x)**2+(b.y-a.y)**2;if(!l2)return;let t=((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/l2;t=Math.max(0,Math.min(1,t));const d=Math.hypot(p.x-(a.x+t*(b.x-a.x)),p.y-(a.y+t*(b.y-a.y)));if(d<bestD){best=e;bestD=d;}});return best}
  function coords(ev){const r=canvas.getBoundingClientRect();return{x:ev.clientX-r.left,y:ev.clientY-r.top}}
  canvas.addEventListener('pointerdown',ev=>{const p=coords(ev),n=findNode(p.x,p.y);canvas.setPointerCapture(ev.pointerId);state.drag=n||{pan:true,start:p,tx:state.tx,ty:state.ty};if(n){n.vx=n.vy=0;}canvas.classList.add('dragging')});
  canvas.addEventListener('pointermove',ev=>{const p=coords(ev);if(state.drag){if(state.drag.pan){state.tx=state.drag.tx+p.x-state.drag.start.x;state.ty=state.drag.ty+p.y-state.drag.start.y;}else{const w=screenToWorld(p.x,p.y);state.drag.x=w.x;state.drag.y=w.y;}state.dirty=true;return;}const n=findNode(p.x,p.y),edge=n?null:findEdge(p.x,p.y);if(n!==state.hovered||edge!==state.hoveredEdge){state.hovered=n;state.hoveredEdge=edge;canvas.title=edge?edge.label:'';canvas.style.cursor=n?'pointer':edge?'help':'grab';state.dirty=true;}});
  canvas.addEventListener('pointerup',ev=>{const p=coords(ev),n=findNode(p.x,p.y),drag=state.drag;state.drag=null;canvas.classList.remove('dragging');if(n&&drag===n)selectNode(n);state.running=false});
  canvas.addEventListener('dblclick',ev=>{const p=coords(ev),n=findNode(p.x,p.y);if(n)centerOn(n,true)});
  canvas.addEventListener('wheel',ev=>{ev.preventDefault();const p=coords(ev),before=screenToWorld(p.x,p.y),next=Math.max(.42,Math.min(2.2,state.scale*Math.exp(-ev.deltaY*.001)));state.scale=next;state.tx=p.x-state.width/2-before.x*next;state.ty=p.y-state.height/2-before.y*next;state.dirty=true},{passive:false});

  function fit(){if(!state.nodes.length)return;const xs=state.nodes.map(n=>n.x),ys=state.nodes.map(n=>n.y),w=Math.max(...xs)-Math.min(...xs)+260,h=Math.max(...ys)-Math.min(...ys)+180;state.scale=Math.max(.42,Math.min(1,Math.min(state.width/w,state.height/h)));state.tx=-(Math.max(...xs)+Math.min(...xs))/2*state.scale;state.ty=-(Math.max(...ys)+Math.min(...ys))/2*state.scale;state.dirty=true}
  function centerOn(n,zoom=false){state.scale=zoom?Math.max(state.scale,1.15):state.scale;state.tx=-n.x*state.scale;state.ty=-n.y*state.scale;state.dirty=true}

  function relationHTML(n,direction){const rows=state.data.edges.filter(e=>direction==='up'?targetId(e)===n.id:sourceId(e)===n.id);if(!rows.length)return'';return `<div class="relations"><h3>${direction==='up'?'上游':'下游'}</h3><div class="rel-list">${rows.map(e=>{const id=direction==='up'?sourceId(e):targetId(e),other=state.data.nodeMap.get(id);return `<button class="rel-btn" type="button" data-node="${id}">${esc(KINDS[e.kind][0])} · ${esc(other.title)}</button>`}).join('')}</div></div>`}
  function selectNode(n,push=true){state.selected=n;detail.classList.toggle('has-selection',!!n);if(n){document.querySelector('#side-note').textContent=n.stage==='side'?'非主路径 / OPTIONAL':'NODE DETAIL';document.querySelector('#detail-title').textContent=n.title;document.querySelector('#detail-tags').innerHTML=`<span class="tag stage" style="--stage:${stageColor(n.stage)}">${STAGES[n.stage][0]}</span>${(n.paths||[]).map(p=>`<span class="tag">${PATHS[p]}</span>`).join('')}`;document.querySelector('#detail-body').innerHTML=`${n.timing?`<div class="timing"><strong>建议时机</strong><br>${esc(n.timing)}</div>`:''}<p class="summary">${esc(n.summary)}</p><div class="copy">${n.body.map(p=>`<p>${esc(p)}</p>`).join('')}</div>${n.pitfalls?.length?`<div class="warning"><strong>注意</strong><ul>${n.pitfalls.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></div>`:''}${relationHTML(n,'up')}${relationHTML(n,'down')}`;document.querySelectorAll('[data-node]').forEach(b=>b.onclick=()=>selectNode(state.data.nodeMap.get(b.dataset.node)));if(push){const u=new URL(location.href);u.searchParams.set('node',n.id);history.replaceState(null,'',u);}centerOn(n,false);}else if(push){const u=new URL(location.href);u.searchParams.delete('node');history.replaceState(null,'',u);}state.dirty=true}

  function setupSearch(){const input=document.querySelector('#search');input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();state.nodes.forEach(n=>n._match=!q||[n.title,...(n.aliases||[])].join(' ').toLowerCase().includes(q));const first=state.nodes.find(n=>n._match);if(q&&first){state.hovered=first;centerOn(first,false)}state.dirty=true});input.addEventListener('keydown',e=>{if(e.key==='Enter'){const q=input.value.trim().toLowerCase(),n=state.nodes.find(n=>[n.title,...(n.aliases||[])].join(' ').toLowerCase().includes(q));if(n)selectNode(n);}});addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea/i.test(document.activeElement.tagName)){e.preventDefault();input.focus()}if(e.key==='Escape'){input.value='';state.hovered=null;selectNode(null);}})}

  async function init(){initControls();setupSearch();try{const data=await fetch('graph.json').then(r=>{if(!r.ok)throw Error('graph');return r.json()});data.nodeMap=new Map(data.nodes.map(n=>[n.id,n]));state.data=data;seedPositions();applyFilters();resize();fit();draw();const id=new URLSearchParams(location.search).get('node');if(id&&data.nodeMap.has(id))selectNode(data.nodeMap.get(id),false);new ResizeObserver(()=>{resize();fit();draw();}).observe(wrap);setInterval(frame,33);}catch(err){document.querySelector('#graph-status').textContent='图谱载入失败，请刷新重试';console.error(err)}}
  init();
})();
