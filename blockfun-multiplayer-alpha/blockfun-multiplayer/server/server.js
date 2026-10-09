import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
const PORT=Number(process.env.PORT||3000);
const publicHost=process.env.RENDER_EXTERNAL_HOSTNAME||'multiplayer-xnqs.onrender.com';
const allowed=new Set(['https://'+publicHost,'https://zippy-piroshki-e7d3fc.netlify.app','https://dynamic-klepon-d46485.netlify.app',...(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)]);
if(process.env.NODE_ENV!=='production'){allowed.add('http://localhost:'+PORT);allowed.add('http://127.0.0.1:'+PORT)}
const site=fileURLToPath(new URL('../site/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json'};
const players=new Map(),history=[];
const MAX=40;
const server=http.createServer(async(req,res)=>{
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'BLOCKFUN',version:'0.4.0',online:players.size,ok:true}));return}
 let filename;try{filename=resolve(site,'.'+decodeURIComponent(path==='/'?'/index.html':path))}catch{res.writeHead(400);res.end();return}
 if(!filename.startsWith(site.endsWith(sep)?site:site+sep)){res.writeHead(403);res.end();return}
 try{const bytes=await readFile(filename);res.setHeader('Content-Type',mime[extname(filename)]||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-cache');res.end(req.method==='HEAD'?undefined:bytes)}catch{res.writeHead(404);res.end('Not found')}
});
const wss=new WebSocketServer({server,maxPayload:2048,verifyClient:({origin})=>!origin||allowed.has(origin)});
function send(ws,msg){if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<256000)ws.send(JSON.stringify(msg))}
function broadcast(msg,exclude){for(const p of players.values())if(p.ws!==exclude)send(p.ws,msg)}
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const validNum=n=>typeof n==='number'&&Number.isFinite(n);
const cleanName=n=>String(n||'Miner').replace(/[^\p{L}\p{N} _.-]/gu,'').slice(0,18)||'Miner';
const profile=({id,x,y,z,yaw,skin,name,moving})=>({id,x,y,z,yaw,skin,avatar:skin,name,moving});
wss.on('connection',ws=>{
 if(players.size>=MAX){ws.close(1013,'Room full');return}
 const p={id:randomUUID().slice(0,8),ws,x:0,y:1.62,z:14,yaw:0,skin:Math.floor(Math.random()*6),name:'Miner',moving:false,last:Date.now(),chatAt:0,editAt:0,alive:true,window:Date.now(),messages:0};players.set(p.id,p);
 send(ws,{t:'hello',id:p.id,players:[...players.values()].filter(a=>a!==p).map(profile),history});
 broadcast({t:'join',...profile(p)},ws);ws.on('pong',()=>p.alive=true);
 ws.on('message',bytes=>{
  const now=Date.now();if(now-p.window>=1000){p.window=now;p.messages=0}if(++p.messages>40){ws.close(1008,'Rate limit');return}
  let m;try{m=JSON.parse(bytes.toString())}catch{return}if(!m||typeof m!=='object')return;
  if(m.t==='profile'){p.name=cleanName(m.name);if(Number.isInteger(m.skin))p.skin=clamp(m.skin,0,5);broadcast({t:'profile',...profile(p)});return}
  if(m.t==='chat'){
   if(now-p.chatAt<800||typeof m.text!=='string')return;const text=m.text.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,140);if(!text)return;p.chatAt=now;
   const message={t:'chat',id:p.id,name:p.name,text};history.push(message);if(history.length>30)history.shift();broadcast(message);return;
  }
  if(m.t==='respawn'){Object.assign(p,{x:0,y:1.62,z:14,moving:false,last:now});broadcast({t:'move',...profile(p)});return}
  if(m.t==='move'){
   if(![m.x,m.y,m.z,m.yaw].every(validNum)||now-p.last<45)return;
   const x=clamp(m.x,-48.4,48.4),z=clamp(m.z,-48.4,48.4),y=clamp(m.y,-.5,20);
   const distance=Math.hypot(x-p.x,z-p.z),elapsed=Math.min(2,(now-p.last)/1000);
   if(distance>12*elapsed+1.5){send(ws,{t:'correct',x:p.x,y:p.y,z:p.z});return}
   Object.assign(p,{x,y,z,yaw:clamp(m.yaw,-1e6,1e6),moving:!!m.moving,last:now});broadcast({t:'move',...profile(p)},ws);return;
  }
  if(m.t==='edit')send(ws,{t:'patch',x:m.x,z:m.z,state:0,request:m.request,rejected:'Spawn protected'});
 });
 ws.on('close',()=>{players.delete(p.id);broadcast({t:'leave',id:p.id})});ws.on('error',()=>{});
});
const heartbeat=setInterval(()=>{for(const p of players.values()){if(!p.alive){p.ws.terminate();continue}p.alive=false;p.ws.ping()}},30000);
server.on('close',()=>clearInterval(heartbeat));
server.listen(PORT,'0.0.0.0',()=>console.log(`BLOCKFUN 0.4 listening on ${PORT}`));
