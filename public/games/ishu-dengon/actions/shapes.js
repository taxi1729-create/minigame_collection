// actions/shapes.js - 抽象図形アクション

const SHAPE_TYPES  = ['triangle','diamond','circle','square','star','hexagon'];
const SHAPE_COLORS = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6','#1abc9c','#34495e','#ffffff','#000000'];
const SHAPE_LABELS = { triangle:'▲三角', diamond:'◆菱形', circle:'●円', square:'■四角', star:'★星', hexagon:'⬡六角' };

function renderShapesAction(container, topic, prevRecord, onComplete, onReselect) {
  if (typeof prevRecord === 'function') { onComplete = prevRecord; prevRecord = null; }
  const prevHtml = prevRecord
    ? (typeof buildPrevContentHtml === 'function' ? buildPrevContentHtml(prevRecord) : '')
    : '';

  container.innerHTML = `
    <div class="action-container shapes-action">
      <h2 class="action-title">🔷 抽象図形</h2>
      ${prevHtml}
      <div class="current-topic-display">
        <span class="current-topic-label">あなたの修飾語</span>
        <span class="current-topic-value">${topic}</span>
      </div>
      <div class="shapes-toolbar">
        <div class="shape-buttons">
          ${SHAPE_TYPES.map(s=>`<button class="shape-add-btn" data-shape="${s}">${SHAPE_LABELS[s]}</button>`).join('')}
        </div>
        <div class="color-palette">
          ${SHAPE_COLORS.map(c=>`<button class="color-dot" data-color="${c}" style="background:${c};"></button>`).join('')}
        </div>
      </div>
      <canvas id="shapesCanvas" class="shapes-canvas"></canvas>
      <p class="shape-hint">タップで選択 → 色変更 ／ ドラッグで移動 ／ 長押しで削除</p>
      <button class="btn btn-primary" id="shapesDoneBtn">完成！次の人へ渡す ▶</button>
      <button class="btn btn-reselect" id="shapesReselectBtn">↩ アクションを選び直す</button>
    </div>
  `;

  const canvas = document.getElementById('shapesCanvas');
  const ctx = canvas.getContext('2d');
  let shapes = [], selectedId = null, dragging = false, dragOffX = 0, dragOffY = 0, longPressTimer = null;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.min(rect.width - 16, 420);
    canvas.width = w; canvas.height = w;
    drawAll();
  }

  function newShape(type) {
    return { id: Date.now()+Math.random(), type, x: canvas.width/2, y: canvas.height/2, size: 40, color: '#3498db', selected: false };
  }

  function drawShape(s) {
    ctx.save();
    ctx.fillStyle = s.color;
    ctx.strokeStyle = s.selected ? '#ff0' : 'rgba(0,0,0,0.25)';
    ctx.lineWidth = s.selected ? 3 : 1;
    const {x,y,size,type} = s;
    ctx.beginPath();
    switch(type){
      case 'triangle': ctx.moveTo(x,y-size); ctx.lineTo(x+size*.866,y+size*.5); ctx.lineTo(x-size*.866,y+size*.5); ctx.closePath(); break;
      case 'diamond':  ctx.moveTo(x,y-size); ctx.lineTo(x+size*.6,y); ctx.lineTo(x,y+size); ctx.lineTo(x-size*.6,y); ctx.closePath(); break;
      case 'circle':   ctx.arc(x,y,size,0,Math.PI*2); break;
      case 'square':   ctx.rect(x-size,y-size,size*2,size*2); break;
      case 'star':
        for(let i=0;i<10;i++){const r=i%2===0?size:size*.4,a=(i*Math.PI)/5-Math.PI/2;i===0?ctx.moveTo(x+r*Math.cos(a),y+r*Math.sin(a)):ctx.lineTo(x+r*Math.cos(a),y+r*Math.sin(a));}
        ctx.closePath(); break;
      case 'hexagon':
        for(let i=0;i<6;i++){const a=(i*Math.PI)/3;i===0?ctx.moveTo(x+size*Math.cos(a),y+size*Math.sin(a)):ctx.lineTo(x+size*Math.cos(a),y+size*Math.sin(a));}
        ctx.closePath(); break;
    }
    ctx.fill(); ctx.stroke(); ctx.restore();
  }

  function drawAll() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#f8f8f8'; ctx.fillRect(0,0,canvas.width,canvas.height);
    shapes.forEach(drawShape);
  }

  function getPos(e) {
    const r=canvas.getBoundingClientRect(), sx=canvas.width/r.width, sy=canvas.height/r.height;
    const t=e.touches?e.touches[0]:e;
    return {x:(t.clientX-r.left)*sx, y:(t.clientY-r.top)*sy};
  }

  function hit(p){for(let i=shapes.length-1;i>=0;i--){const s=shapes[i],dx=p.x-s.x,dy=p.y-s.y;if(Math.sqrt(dx*dx+dy*dy)<s.size*1.2)return s;}return null;}

  function onStart(e){
    e.preventDefault();
    const p=getPos(e), h=hit(p);
    longPressTimer=setTimeout(()=>{if(h){shapes=shapes.filter(s=>s.id!==h.id);selectedId=null;drawAll();vibrate&&vibrate([30]);}},600);
    if(h){selectedId=h.id;shapes.forEach(s=>s.selected=s.id===selectedId);dragOffX=p.x-h.x;dragOffY=p.y-h.y;dragging=true;}
    else{selectedId=null;shapes.forEach(s=>s.selected=false);}
    drawAll();
  }
  function onMove(e){
    e.preventDefault();
    if(!dragging||!selectedId)return;
    clearTimeout(longPressTimer);
    const p=getPos(e),s=shapes.find(s=>s.id===selectedId);
    if(s){s.x=p.x-dragOffX;s.y=p.y-dragOffY;drawAll();}
  }
  function onEnd(e){e.preventDefault();clearTimeout(longPressTimer);dragging=false;}

  canvas.addEventListener('mousedown',onStart); canvas.addEventListener('mousemove',onMove); canvas.addEventListener('mouseup',onEnd);
  canvas.addEventListener('touchstart',onStart,{passive:false}); canvas.addEventListener('touchmove',onMove,{passive:false}); canvas.addEventListener('touchend',onEnd,{passive:false});

  document.querySelectorAll('.shape-add-btn').forEach(btn=>{
    btn.onclick=()=>{const s=newShape(btn.dataset.shape);shapes.push(s);selectedId=s.id;shapes.forEach(sh=>sh.selected=sh.id===selectedId);drawAll();};
  });
  document.querySelectorAll('.color-dot').forEach(btn=>{
    btn.onclick=()=>{if(selectedId){const s=shapes.find(s=>s.id===selectedId);if(s){s.color=btn.dataset.color;drawAll();}}};
  });

  resize();

  document.getElementById('shapesDoneBtn').onclick = () => {
    const imageData = canvas.toDataURL('image/png');
    onComplete({ imageData, shapes: JSON.parse(JSON.stringify(shapes)) });
  };
  document.getElementById('shapesReselectBtn').onclick = onReselect;
}
