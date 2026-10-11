import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
const PORT=Number(process.env.PORT||3000);
const publicHost=process.env.RENDER_EXTERNAL_HOSTNAME||'multiplayer-xnqs.onrender.com';
const allowed=new Set([
 'https://'+publicHost,
 'https://tweetpump.fun',
 'https://www.tweetpump.fun',
 'https://zippy-piroshki-e7d3fc.netlify.app',
 'https://dynamic-klepon-d46485.netlify.app',
 ...(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim().replace(/\/$/,'')).filter(Boolean)
]);
if(process.env.NODE_ENV!=='production'){allowed.add('http://localhost:'+PORT);allowed.add('http://127.0.0.1:'+PORT)}
const site=fileURLToPath(new URL('../site/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const players=new Map(),history=[],mintRate=new Map();
const MAX=40;
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
async function readJson(req,max=240000){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw Error('Request too large');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}
const clean=(v,n)=>String(v||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n);
function creatorWallet(){const raw=process.env.CREATOR_WALLET_SECRET;if(!raw)return null;return Keypair.fromSecretKey(bs58.decode(raw))}
async function createCoin(req,res){
 if(!process.env.CREATOR_CODE||req.headers['x-creator-code']!==process.env.CREATOR_CODE)return json(res,403,{error:'Invalid creator code'});
 const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0],now=Date.now();if(now-(mintRate.get(ip)||0)<30000)return json(res,429,{error:'Wait 30 seconds before another creation'});
 let body;try{body=await readJson(req)}catch(e){return json(res,400,{error:e.message})}
 const name=clean(body.name,32),symbol=clean(body.ticker,10).toUpperCase(),description=clean(body.story||body.theme,240),website=clean(body.website,120),twitter=clean(body.x,60);
 if(name.length<2||!/^[A-Z0-9]{2,10}$/.test(symbol))return json(res,400,{error:'Invalid name or ticker'});
 const creator=creatorWallet();if(!creator)return json(res,503,{error:'Creator wallet is not configured'});
 const mint=Keypair.generate(),origin='https://'+publicHost,metadataUrl=new URL('/api/token-metadata',origin);for(const [k,v] of Object.entries({name,symbol,description,website,twitter}))if(v)metadataUrl.searchParams.set(k,v);
 try{
  const built=await fetch('https://pumpportal.fun/api/trade-local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({publicKey:creator.publicKey.toBase58(),action:'create',tokenMetadata:{name,symbol,uri:metadataUrl.href},mint:mint.publicKey.toBase58(),denominatedInSol:'true',amount:0,slippage:1,priorityFee:0,pool:'pump'})});
  if(!built.ok)throw Error('Transaction builder rejected: '+await built.text());
  const tx=VersionedTransaction.deserialize(new Uint8Array(await built.arrayBuffer()));tx.sign([mint,creator]);
  const connection=new Connection(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com','confirmed'),signature=await connection.sendTransaction(tx,{maxRetries:3});await connection.confirmTransaction(signature,'confirmed');
  mintRate.set(ip,now);return json(res,200,{status:'confirmed',mint:mint.publicKey.toBase58(),signature});
 }catch(e){console.error('coin create failed',e);return json(res,502,{error:'Blockchain creation failed: '+clean(e.message,180)})}
}
const server=http.createServer(async(req,res)=>{
 const requestUrl=new URL(req.url,'http://localhost'),path=requestUrl.pathname;
 if(req.method==='POST'&&path==='/api/coins')return createCoin(req,res);
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
 if(path==='/api/creator-wallet'){const wallet=creatorWallet();return json(res,wallet?200:503,wallet?{address:wallet.publicKey.toBase58(),network:'solana-mainnet',estimatedMinimumSol:.006,recommendedFundingSol:.007,devBuySol:0,priorityFeeSol:0}:{error:'Wallet not configured'})}
 if(path==='/api/token-metadata'){const q=requestUrl.searchParams;return json(res,200,{name:clean(q.get('name'),32),symbol:clean(q.get('symbol'),10),description:clean(q.get('description'),240),image:'https://'+publicHost+'/preview.png',external_url:clean(q.get('website'),120),twitter:clean(q.get('twitter'),60),createdOn:'TweetPump.fun'})}
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
 const p={id:randomUUID().slice(0,8),ws,x:0,y:1.62,z:14,yaw:0,skin:Math.floor(Math.random()*4),name:'Miner',moving:false,last:Date.now(),chatAt:0,editAt:0,alive:true,window:Date.now(),messages:0};players.set(p.id,p);
 send(ws,{t:'hello',id:p.id,players:[...players.values()].filter(a=>a!==p).map(profile),history});
 broadcast({t:'join',...profile(p)},ws);ws.on('pong',()=>p.alive=true);
 ws.on('message',bytes=>{
  const now=Date.now();if(now-p.window>=1000){p.window=now;p.messages=0}if(++p.messages>40){ws.close(1008,'Rate limit');return}
  let m;try{m=JSON.parse(bytes.toString())}catch{return}if(!m||typeof m!=='object')return;
  if(m.t==='profile'){p.name=cleanName(m.name);if(Number.isInteger(m.skin))p.skin=clamp(m.skin,0,3);broadcast({t:'profile',...profile(p)});return}
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
