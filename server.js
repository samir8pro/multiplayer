import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://dynamic-klepon-d46485.netlify.app')
  .split(',').map(s => s.trim().replace(/\/$/,'')).filter(Boolean);
const MAX_PLAYERS = 80, MAX_EDITS = 3000;
const players = new Map(), edits = new Map(), history = [];
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const isNum = n => typeof n === 'number' && Number.isFinite(n);
const cleanName = text => typeof text === 'string'
  ? text.trim().replace(/[^\p{L}\p{N}_ .-]/gu, '').slice(0, 18) : '';
const send = (ws, message) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
const broadcast = (message, except) => { for (const p of players.values()) if (p.ws !== except) send(p.ws, message); };
const profile = p => ({ id:p.id, name:p.name, skin:p.skin, x:p.x, y:p.y, z:p.z, yaw:p.yaw, moving:p.moving });
const inSpawn = (x,z) => Math.abs(x)<50 && Math.abs(z)<50;

const server = http.createServer((req,res) => {
  res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify({
    ok:true, service:'BLOCKFUN multiplayer - new Netlify', version:'1.0.0',
    online:players.size, world:'1000x1000 continuous grass and dirt',
    allowedOrigins:ALLOWED_ORIGINS, demoCoinsOnly:true
  }));
});
const wss = new WebSocketServer({server, maxPayload:8192,
  verifyClient: info => !!info.origin && ALLOWED_ORIGINS.includes(info.origin.replace(/\/$/,''))});
const key = (x,y,z) => x+','+y+','+z;

wss.on('connection', ws => {
  if (players.size >= MAX_PLAYERS) { ws.close(1013, 'Full'); return; }
  const id = randomUUID().slice(0, 8);
  const p = {
    id, ws, x:0, y:1.62, z:14, yaw:0, moving:false,
    skin:Math.floor(Math.random()*6), name:'Miner_'+id.slice(0,4),
    lastMove:0,lastChat:0,lastEdit:0
  };
  send(ws,{t:'hello',id,players:[...players.values()].map(profile),history,edits:[...edits.values()]});
  players.set(id,p);
  broadcast({t:'join',...profile(p)},ws);

  ws.on('message', raw => {
    let m; try { m=JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m.t!=='string') return;
    const now=Date.now();

    if (m.t==='profile') {
      p.name=cleanName(m.name)||p.name;
      if (Number.isInteger(m.skin)) p.skin=clamp(m.skin,0,5);
      broadcast({t:'profile',id,name:p.name,skin:p.skin},ws);
      return;
    }
    if (m.t==='move') {
      if (![m.x,m.y,m.z,m.yaw].every(isNum) || now-p.lastMove < 75) return;
      const x=clamp(m.x,-499,499),z=clamp(m.z,-499,499),y=clamp(m.y,-10,32);
      if (Math.hypot(x-p.x,z-p.z)>5.5) return;
      p.lastMove=now;
      Object.assign(p,{x,y,z,yaw:clamp(m.yaw,-100000,100000),moving:!!m.moving});
      broadcast({t:'move',id,x,y,z,yaw:p.yaw,moving:p.moving},ws);
      return;
    }
    if (m.t==='chat') {
      if (typeof m.text!=='string'||now-p.lastChat<1000) return;
      const content=m.text.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,140);
      if (!content) return;
      p.lastChat=now;
      const message={t:'chat',id,name:p.name,text:content,time:now};
      history.push(message);if(history.length>35)history.shift();
      broadcast(message);return;
    }
    if (m.t==='edit') {
      if (now-p.lastEdit<100) return;
      if (![m.x,m.y,m.z].every(Number.isInteger)|| !['break','place'].includes(m.action)) return;
      const {x,y,z}=m;
      if (Math.abs(x)>=499||Math.abs(z)>=499||y<-1||y>0||
          inSpawn(x,z)||Math.hypot(x-p.x,z-p.z)>9) return;
      if (m.action==='place' && !['grass','dirt'].includes(m.block)) return;
      const k=key(x,y,z);
      if(!edits.has(k)&&edits.size>=MAX_EDITS) return;
      p.lastEdit=now;
      const patch={t:'patch',x,y,z,action:m.action,block:m.action==='place'?m.block:null};
      edits.set(k,patch);broadcast(patch,ws);
      send(ws,{t:'edit-ok',x,y,z,action:m.action,block:m.block||null});
    }
  });
  ws.on('close',()=>{players.delete(id);broadcast({t:'leave',id})});
  ws.on('error',()=>{});
});

setInterval(()=>{ for(const p of players.values()) {
  if(p.ws.readyState===WebSocket.OPEN)p.ws.ping();
  else if(p.ws.readyState!==WebSocket.CONNECTING)p.ws.terminate();
}},30000);
server.listen(PORT,'0.0.0.0',()=>console.log('BLOCKFUN new multiplayer on '+PORT));
