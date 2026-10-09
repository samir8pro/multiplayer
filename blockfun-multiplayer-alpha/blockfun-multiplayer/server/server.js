import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const PORT=Number(process.env.PORT||3000);
const allowed=(process.env.ALLOWED_ORIGINS||'https://zippy-piroshki-e7d3fc.netlify.app').split(',').map(s=>s.trim());
const players=new Map();const MAX=80;
const server=http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'BLOCKFUN multiplayer',online:players.size,ok:true}))});
const wss=new WebSocketServer({server,maxPayload:2048,verifyClient:({origin})=>!origin||allowed.includes(origin)});
function send(ws,msg){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg))}
function broadcast(msg,exclude){for(const p of players.values())if(p.ws!==exclude)send(p.ws,msg)}
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
function validNum(n){return typeof n==='number'&&Number.isFinite(n)}
wss.on('connection',(ws)=>{
 if(players.size>=MAX){ws.close(1013,'Room full');return}
 const id=randomUUID().slice(0,8), avatar=Math.floor(Math.random()*6);
 const p={id,ws,x:0,y:1.7,z:5,yaw:0,avatar,last:0};players.set(id,p);
 send(ws,{t:'hello',id,players:[...players.values()].filter(a=>a.id!==id).map(({id,x,y,z,yaw,avatar})=>({id,x,y,z,yaw,avatar}))});
 broadcast({t:'join',id,x:p.x,y:p.y,z:p.z,yaw:0,avatar},ws);
 ws.on('message',(bytes)=>{
  let m;try{m=JSON.parse(bytes.toString())}catch{return}
  if(m?.t!=='move'||!validNum(m.x)||!validNum(m.y)||!validNum(m.z)||!validNum(m.yaw))return;
  const now=Date.now();if(now-p.last<45)return; p.last=now;
  // Limited movement: max ~12 blocks/s plus tolerance for network jitter.
  const x=clamp(m.x,-49,49),z=clamp(m.z,-49,49),y=clamp(m.y,1.7,12);
  if(Math.hypot(x-p.x,z-p.z)>3.5)return;
  Object.assign(p,{x,y,z,yaw:clamp(m.yaw,-1e6,1e6)});
  broadcast({t:'move',id,x,y,z,yaw:p.yaw},ws);
 });
 ws.on('close',()=>{players.delete(id);broadcast({t:'leave',id})});
 ws.on('error',()=>{});
});
setInterval(()=>{for(const p of players.values()){if(p.ws.readyState!==WebSocket.OPEN){p.ws.terminate();continue}p.ws.ping()}},30000);
server.listen(PORT,'0.0.0.0',()=>console.log(`BLOCKFUN multiplayer listening on ${PORT}`));
