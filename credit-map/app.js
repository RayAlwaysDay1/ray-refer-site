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
  const state = { data: null, nodes: [], edges: [], selected: null, hovered: null, hoveredEdge: null, drag: null, activePath: 'p1', showAll: false, stages: new Set(stageOrder), kinds: new Set(kindOrder), scale: 1, tx: 0, ty: 0, width: 0, height: 0, dirty: true, running: false };
  const MAIN_PATH = new Set(['address','itin','c1','hilton','green','chase-hotel','venturex']);
  const MONITORS = new Set(['equifax','tu','ex']);

  const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const sourceId = e => typeof e.source === 'object' ? e.source.id : e.source;
  const targetId = e => typeof e.target === 'object' ? e.target.id : e.target;
  const stageColor = stage => STAGES[stage]?.[1] || '#e7ecf3';

  function initControls() {
    const stageBox = document.querySelector('#stage-filters');
    stageBox.innerHTML = stageOrder.map(key => `<button class="check" type="button" data-stage="${key}" aria-pressed="true"><span>${STAGES[key][0]}</span><i class="dot" style="--c:${STAGES[key][1]}"></i></button>`).join('');
    const edgeBox = document.querySelector('#edge-filters');
    edgeBox.innerHTML = kindOrder.map(key => `<button class="check" type="button" data-kind="${key}" aria-pressed="true"><span>${KINDS[key][0]}</span><i class="dot" style="--c:${KINDS[key][1]}"></i></button>`).join('');
    document.querySelector('#path-filters').innerHTML = Object.entries(PATHS).map(([key,label]) => `<button class="path" type="button" data-path="${key}" aria-pressed="${key==='p1'}">${label}</button>`).join('');
    document.querySelector('#legend').insertAdjacentHTML('beforeend', kindOrder.map(key => `<div class="legend-row"><i class="legend-line ${key==='optional'?'dash':key==='monitors'?'dotline':key==='stacks'?'double':''}" style="--lc:${KINDS[key][1]}"></i><span>${KINDS[key][0]}</span></div>`).join(''));

    stageBox.addEventListener('click', e => { const b=e.target.closest('[data-stage]'); if(!b)return; const k=b.dataset.stage; state.stages.has(k)?state.stages.delete(k):state.stages.add(k); b.setAttribute('aria-pressed',state.stages.has(k)); applyFilters(); });
    edgeBox.addEventListener('click', e => { const b=e.target.closest('[data-kind]'); if(!b)return; const k=b.dataset.kind; state.kinds.has(k)?state.kinds.delete(k):state.kinds.add(k); b.setAttribute('aria-pressed',state.kinds.has(k)); applyFilters(); });
    document.querySelector('#path-filters').addEventListener('click', e => { const b=e.target.closest('[data-path]'); if(!b)return; state.activePath=b.dataset.path; state.showAll=false; document.querySelector('#show-all').setAttribute('aria-pressed','false'); document.querySelector('#show-all').textContent='显示全部节点'; document.querySelectorAll('[data-path]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.path===state.activePath)); applyFilters(true); });
    document.querySelector('#show-all').onclick = e => { state.showAll=!state.showAll; e.currentTarget.setAttribute('aria-pressed',String(state.showAll)); e.currentTarget.textContent=state.showAll?'收起旁路节点':'显示全部节点'; applyFilters(true); };
    document.querySelector('#fit').onclick = fit;
    document.querySelector('#legend-toggle').onclick = e => { const hidden=!document.querySelector('#legend').hidden; document.querySelector('#legend').hidden=hidden; e.currentTarget.setAttribute('aria-pressed',String(!hidden)); };
    document.querySelector('#close-detail').onclick = () => selectNode(null);
  }

  function basePathNodes(path) {
    const ids = new Set(['cloud-resident','address','phone','itin','repay','c1','five24','equifax','tu','ex']);
    state.data.nodes.forEach(n => { if (n.paths?.includes(path)) ids.add(n.id); });
    state.data.edges.forEach(e => { if (e.paths?.includes(path)) { ids.add(sourceId(e)); ids.add(targetId(e)); } });
    return ids;
  }
  function applyFilters(refit=false) {
    const pathIds = basePathNodes(state.activePath || 'p1');
    state.nodes = state.data.nodes.filter(n => state.stages.has(n.stage) && (state.showAll || pathIds.has(n.id)));
    const ids = new Set(state.nodes.map(n=>n.id));
    state.edges = state.data.edges.filter(e => state.kinds.has(e.kind) && ids.has(sourceId(e)) && ids.has(targetId(e)) && (state.showAll || !e.paths || e.paths.includes(state.activePath) || ['requires','blocks','monitors'].includes(e.kind)));
    document.querySelector('#graph-status').textContent = `${state.nodes.length} 节点 · ${state.edges.length} 关系 · ${state.showAll?'全部节点':PATHS[state.activePath]}`;
    if (state.selected && !ids.has(state.selected.id)) selectNode(null);
    state.running=false; state.dirty=true; if(refit){seedPositions();setTimeout(()=>{fit();draw();},40)}
  }

  function seedPositions() {
    const horizontal={
      'cloud-resident':[-850,-220],'address':[-720,0],'phone':[-480,-190],'itin':[-480,0],'repay':[-240,190],
      'c1':[-240,0],'hilton':[20,0],'green':[270,0],'chase-hotel':[540,0],'venturex':[800,0],'five24':[540,-190],
      'savor':[20,190],'aspire':[280,190],'gold':[20,310],'csp':[280,310],'platinum':[540,310],
      'bilt':[270,-190],'apple':[540,-310],'gt':[-240,-310],'au':[-480,190],
      'equifax':[160,500],'tu':[410,500],'ex':[660,500],
      'bad-address':[-660,500],'sofi':[900,270],'rakuten':[900,390],'kraken':[900,510]
    };
    const vertical={
      'cloud-resident':[-230,-440],'address':[0,-320],'phone':[-230,-200],'itin':[0,-180],'repay':[-230,-40],
      'c1':[0,-40],'hilton':[0,100],'green':[0,240],'chase-hotel':[0,380],'venturex':[0,520],'five24':[360,380],
      'savor':[360,100],'aspire':[360,240],'gold':[780,100],'csp':[780,240],'platinum':[780,520],
      'bilt':[-420,240],'apple':[-420,380],'gt':[-420,100],'au':[-420,-40],
      'equifax':[-300,680],'tu':[0,680],'ex':[300,680],
      'bad-address':[-800,520],'sofi':[1120,400],'rakuten':[1120,520],'kraken':[1120,640]
    };
    state.vertical=wrap.getBoundingClientRect().width<720;
    const fixed=state.vertical?vertical:horizontal;
    state.data.nodes.forEach((n,i)=>{const p=fixed[n.id]||[state.vertical?300:900,900+i*80];n.x=p[0];n.y=p[1];n.targetY=n.y;n.vx=0;n.vy=0;});
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

  function labelWidth(title){
    const units=Array.from(title).reduce((sum,ch)=>sum+(ch.charCodeAt(0)>255?20:11.5),0);
    return Math.max(250,Math.min(380,units+58));
  }

  function traceEdge(a,b,e){
    const horizontal=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)*.8;
    ctx.beginPath();
    if(horizontal){
      const dir=b.x>=a.x?1:-1, sx=a.x+dir*a._w/2, ex=b.x-dir*b._w/2, mid=(sx+ex)/2;
      ctx.moveTo(sx,a.y);ctx.lineTo(mid,a.y);ctx.lineTo(mid,b.y);ctx.lineTo(ex,b.y);
      return {x:ex,y:b.y,angle:dir>0?0:Math.PI};
    }
    const dir=b.y>=a.y?1:-1, sy=a.y+dir*a._h/2, ey=b.y-dir*b._h/2, mid=(sy+ey)/2;
    ctx.moveTo(a.x,sy);ctx.lineTo(a.x,mid);ctx.lineTo(b.x,mid);ctx.lineTo(b.x,ey);
    return {x:b.x,y:ey,angle:dir>0?Math.PI/2:-Math.PI/2};
  }

  function draw() {
    ctx.clearRect(0,0,state.width,state.height);
    const focus=state.selected?connected(state.selected.id):null;
    ctx.save();ctx.translate(state.width/2+state.tx,state.height/2+state.ty);ctx.scale(state.scale,state.scale);
    state.nodes.forEach(n=>{n._w=labelWidth(n.title);n._h=50;});
    state.edges.forEach(e=>{
      const a=state.data.nodeMap.get(sourceId(e)),b=state.data.nodeMap.get(targetId(e));if(!a||!b)return;
      const directlySelected=!focus||((a.id===state.selected?.id||b.id===state.selected?.id));
      ctx.globalAlpha=focus?(directlySelected?.92:.15):.62;ctx.strokeStyle=KINDS[e.kind][1];ctx.fillStyle=KINDS[e.kind][1];ctx.lineWidth=(e.kind==='blocks'?2.8:MAIN_PATH.has(a.id)&&MAIN_PATH.has(b.id)?2.25:1.35)/state.scale;
      ctx.setLineDash(e.kind==='optional'?[8/state.scale,6/state.scale]:e.kind==='monitors'?[2/state.scale,6/state.scale]:[]);
      const end=traceEdge(a,b,e);ctx.stroke();ctx.setLineDash([]);
      if(['next','requires','blocks'].includes(e.kind)){const len=9/state.scale;ctx.beginPath();ctx.moveTo(end.x,end.y);ctx.lineTo(end.x-Math.cos(end.angle-.52)*len,end.y-Math.sin(end.angle-.52)*len);ctx.lineTo(end.x-Math.cos(end.angle+.52)*len,end.y-Math.sin(end.angle+.52)*len);ctx.closePath();ctx.fill();}
      if(e.kind==='stacks'){ctx.save();ctx.translate(0,5/state.scale);traceEdge(a,b,e);ctx.stroke();ctx.restore();}
    });
    state.nodes.forEach(n=>{
      const w=n._w,h=n._h,isMain=MAIN_PATH.has(n.id),isSecondary=n.stage==='side'||n.stage==='monitor';
      const faded=(focus&&!focus.has(n.id))||n._match===false;
      ctx.globalAlpha=faded ? .22 : ((isSecondary&&state.selected!==n) ? .62 : 1);
      ctx.shadowColor=stageColor(n.stage);ctx.shadowBlur=(state.selected===n?22:state.hovered===n?12:0)/state.scale;
      roundedRect(n.x-w/2,n.y-h/2,w,h,9);ctx.fillStyle=isMain?'#203147':'#172131';ctx.fill();
      ctx.lineWidth=(state.selected===n?3.4:isMain?2.6:state.hovered===n?2:1.25)/state.scale;ctx.strokeStyle=stageColor(n.stage);ctx.stroke();ctx.shadowBlur=0;
      ctx.fillStyle='#e7ecf3';ctx.font=`700 ${Math.max(11,13/state.scale)}px Inter, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(n.title,n.x,n.y);
      if(!isSecondary){ctx.fillStyle=stageColor(n.stage);ctx.fillRect(n.x-w/2,n.y-h/2,5/state.scale,h);}
    });
    ctx.restore();ctx.globalAlpha=1;
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

  function fit(){if(!state.nodes.length)return;state.nodes.forEach(n=>{n._w=labelWidth(n.title);n._h=50});const minX=Math.min(...state.nodes.map(n=>n.x-n._w/2)),maxX=Math.max(...state.nodes.map(n=>n.x+n._w/2)),minY=Math.min(...state.nodes.map(n=>n.y-n._h/2)),maxY=Math.max(...state.nodes.map(n=>n.y+n._h/2));const w=maxX-minX+100,h=maxY-minY+110;state.scale=Math.max(state.vertical?.43:.5,Math.min(1,Math.min(state.width/w,state.height/h)));state.tx=-(maxX+minX)/2*state.scale;state.ty=-(maxY+minY)/2*state.scale;state.dirty=true}
  function centerOn(n,zoom=false){state.scale=zoom?Math.max(state.scale,1.15):state.scale;state.tx=-n.x*state.scale;state.ty=-n.y*state.scale;state.dirty=true}

  function relationHTML(n,direction){const rows=state.data.edges.filter(e=>direction==='up'?targetId(e)===n.id:sourceId(e)===n.id);if(!rows.length)return'';return `<div class="relations"><h3>${direction==='up'?'上游':'下游'}</h3><div class="rel-list">${rows.map(e=>{const id=direction==='up'?sourceId(e):targetId(e),other=state.data.nodeMap.get(id);return `<button class="rel-btn" type="button" data-node="${id}">${esc(KINDS[e.kind][0])} · ${esc(other.title)}</button>`}).join('')}</div></div>`}
  function selectNode(n,push=true){state.selected=n;detail.classList.toggle('has-selection',!!n);if(n){document.querySelector('#side-note').textContent=n.stage==='side'?'非主路径 / OPTIONAL':'NODE DETAIL';document.querySelector('#detail-title').textContent=n.title;document.querySelector('#detail-tags').innerHTML=`<span class="tag stage" style="--stage:${stageColor(n.stage)}">${STAGES[n.stage][0]}</span>${(n.paths||[]).map(p=>`<span class="tag">${PATHS[p]}</span>`).join('')}`;const cardArt=n.cardImage?`<figure class="card-art"><div class="card-art-frame"><img src="${esc(n.cardImage)}" alt="${esc(n.cardImageAlt||`${n.title} 卡面`)}" loading="eager"></div><figcaption><span>Card Face · 卡面参考</span><span>${esc(n.cardImageCaption||n.title)}</span></figcaption></figure>`:'';document.querySelector('#detail-body').innerHTML=`${cardArt}${n.timing?`<div class="timing"><strong>建议时机</strong><br>${esc(n.timing)}</div>`:''}<p class="summary">${esc(n.summary)}</p><div class="copy">${n.body.map(p=>`<p>${esc(p)}</p>`).join('')}</div>${n.pitfalls?.length?`<div class="warning"><strong>注意</strong><ul>${n.pitfalls.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></div>`:''}${relationHTML(n,'up')}${relationHTML(n,'down')}`;document.querySelectorAll('[data-node]').forEach(b=>b.onclick=()=>selectNode(state.data.nodeMap.get(b.dataset.node)));if(push){const u=new URL(location.href);u.searchParams.set('node',n.id);history.replaceState(null,'',u);}centerOn(n,false);}else if(push){const u=new URL(location.href);u.searchParams.delete('node');history.replaceState(null,'',u);}state.dirty=true}

  function setupSearch(){const input=document.querySelector('#search');input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();state.nodes.forEach(n=>n._match=!q||[n.title,...(n.aliases||[])].join(' ').toLowerCase().includes(q));const first=state.nodes.find(n=>n._match);if(q&&first){state.hovered=first;centerOn(first,false)}state.dirty=true});input.addEventListener('keydown',e=>{if(e.key==='Enter'){const q=input.value.trim().toLowerCase(),n=state.data.nodes.find(n=>[n.title,...(n.aliases||[])].join(' ').toLowerCase().includes(q));if(n){if(!state.nodes.includes(n)){state.showAll=true;document.querySelector('#show-all').setAttribute('aria-pressed','true');document.querySelector('#show-all').textContent='收起旁路节点';applyFilters(true)}selectNode(n);}}});addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea/i.test(document.activeElement.tagName)){e.preventDefault();input.focus()}if(e.key==='Escape'){input.value='';state.nodes.forEach(n=>n._match=true);state.hovered=null;selectNode(null);}})}

  async function init(){initControls();setupSearch();try{const data=await fetch('graph.json?v=20261010-cardart').then(r=>{if(!r.ok)throw Error('graph');return r.json()});data.nodeMap=new Map(data.nodes.map(n=>[n.id,n]));state.data=data;seedPositions();applyFilters();resize();fit();draw();const id=new URLSearchParams(location.search).get('node');if(id&&data.nodeMap.has(id)){const n=data.nodeMap.get(id);if(!state.nodes.includes(n)){state.showAll=true;document.querySelector('#show-all').setAttribute('aria-pressed','true');document.querySelector('#show-all').textContent='收起旁路节点';applyFilters(true)}selectNode(n,false)}new ResizeObserver(()=>{const wasVertical=state.vertical;resize();if(wasVertical!==(wrap.getBoundingClientRect().width<720))seedPositions();fit();draw();}).observe(wrap);setInterval(frame,33);}catch(err){document.querySelector('#graph-status').textContent='图谱载入失败，请刷新重试';console.error(err)}}
  init();
})();
