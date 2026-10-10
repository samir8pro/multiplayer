try {
// BLOCKFUN V7 — dependency-free WebGL1 voxel engine.
// Only two terrain block layers (grass and dirt), chunk meshes, peaceful mode.
const $ = id => document.getElementById(id);
const canvas=$('world');
const gl=(canvas.getContext('webgl',{antialias:false,alpha:false,depth:true,powerPreference:'low-power',preserveDrawingBuffer:false}) || canvas.getContext('webgl',{antialias:false,alpha:false,depth:true}) || canvas.getContext('experimental-webgl'));
if(!gl){throw Error('WebGL unavailable. Try Chrome or enable hardware acceleration')}
const WORLD_HALF=500, SAFE_HALF=50, CHUNK=16, RADIUS=2;
const eye={x:0,y:1.62,z:14,yaw:0,pitch:0,vy:0,ground:true};
const textureNames=['Grass','Dirt','Stone','Ore'];
const inv={grass:0,dirt:0,stone:0,ore:0};
let selected='grass', selectedSlot=0, hotbarSlots=['grass','dirt','stone','ore',null,null,null,null,null], playing=false,typing=false,worldDirty=true,chatOpen=false,lookPointer=null,lastLookX=0,lastLookY=0;
let lastFrame=performance.now(),frameCount=0,fpsStart=performance.now(),frameFps=0,quality=Math.min(1.15,matchMedia('(pointer:coarse)').matches?0.75:1.0),lastQualityChange=performance.now();
const keys={},dig=new Map(),chunks=new Map(),remotes=new Map();
const net={ws:null,id:null,connected:false,retry:0};let lastNetSend=0;
const rayForward=()=>({x:-Math.sin(eye.yaw)*Math.cos(eye.pitch),y:Math.sin(eye.pitch),z:-Math.cos(eye.yaw)*Math.cos(eye.pitch)});
function toast(message){$('toast').textContent=message;$('toast').style.opacity='1';clearTimeout(toast._t);toast._t=setTimeout(()=>$('toast').style.opacity='0',2300)}
function setContext(t){$('contextHint').textContent=t}
// --- GLSL shader: one atlas, instanced-looking batch of exposed faces.
const vs=`attribute vec3 aP; attribute vec2 aUV; attribute float aTile; attribute float aShade; uniform mat4 uVP; uniform vec3 uOffset; uniform float uYaw; varying vec2 vUV; varying float vTile; varying float vShade; varying vec3 vPos; void main(){float c=cos(uYaw),s=sin(uYaw);vec3 p=vec3(c*aP.x+s*aP.z,aP.y,-s*aP.x+c*aP.z)+uOffset;vPos=p;vUV=aUV;vTile=aTile;vShade=aShade;gl_Position=uVP*vec4(p,1.);}`;
const fs=`precision mediump float; varying vec2 vUV; varying float vTile; varying float vShade; varying vec3 vPos; uniform sampler2D uAtlas; uniform vec3 uEye; uniform vec3 uSky; void main(){float t=floor(vTile+.1);vec2 at=vec2(mod(t,4.),floor(t/4.));vec2 uv=(at+mix(vec2(.012),vec2(.988),fract(vUV)))/4.;vec3 color=texture2D(uAtlas,uv).rgb*vShade;float dist=distance(uEye,vPos);float fog=clamp((dist-41.)/24.,0.,1.);gl_FragColor=vec4(mix(color,uSky,fog),1.);}`;
function shader(type,src){let s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
let program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const attr={p:gl.getAttribLocation(program,'aP'),uv:gl.getAttribLocation(program,'aUV'),tile:gl.getAttribLocation(program,'aTile'),shade:gl.getAttribLocation(program,'aShade')};
const uni={vp:gl.getUniformLocation(program,'uVP'),offset:gl.getUniformLocation(program,'uOffset'),yaw:gl.getUniformLocation(program,'uYaw'),eye:gl.getUniformLocation(program,'uEye'),sky:gl.getUniformLocation(program,'uSky'),atlas:gl.getUniformLocation(program,'uAtlas')};
gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.clearColor(.55,.75,1,1);
function makeAtlas(){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');let seed=176382;const rnd=()=>{seed=(Math.imul(1664525,seed)+1013904223)|0;return (seed>>>0)/4294967296};
 const bg=['#6da94c','#8e643f','#845d3b','#7b858e','#ad8253','#806044','#9a573e','#94d3ed','#9aa5ae','#a98b63','#686a6a','#80848a','#92918a','#734cc1','#e2b48e','#bb884c'];
 for(let t=0;t<16;t++){let ox=(t%4)*32,oy=Math.floor(t/4)*32;ctx.fillStyle=bg[t];ctx.fillRect(ox,oy,32,32);for(let j=0;j<140;j++){let x=ox+(rnd()*32|0),y=oy+(rnd()*32|0);const shades=t===0?['#5e9743','#80bb59','#74ae51','#95c66a']:t===1||t===2?['#6d4b31','#a87a4b','#795137']:t===6?['#ab674b','#81422f','#ba7854']:['#ffffff24','#00000026','#ffffff12'];ctx.fillStyle=shades[j%shades.length];ctx.fillRect(x,y,1+(rnd()*3|0),1+(rnd()*3|0))}
 if(t===1){ctx.fillStyle='#66ab47';ctx.fillRect(ox,oy,32,7);for(let i=0;i<26;i++){ctx.fillStyle=i%2?'#599b3e':'#8cc961';ctx.fillRect(ox+(rnd()*32|0),oy+(rnd()*8|0),2,2)}}
 if(t===4||t===5){for(let y=0;y<32;y+=8){ctx.fillStyle='#694529';ctx.fillRect(ox,oy+y,32,1);ctx.fillStyle='#cb9763';ctx.fillRect(ox,oy+y+2,32,1);ctx.fillStyle='#785034';ctx.fillRect(ox+((y*3)%27),oy+y+5,11,1)}}
 if(t===6){for(let y=0;y<32;y+=8){ctx.fillStyle='#62392a';ctx.fillRect(ox,oy+y,32,2);ctx.fillStyle='#c27a59';ctx.fillRect(ox+(y%7),oy+y+2,24,2)}}
 if(t===7){ctx.fillStyle='#58addb';ctx.fillRect(ox+3,oy+3,26,26);ctx.fillStyle='#dffaff';ctx.fillRect(ox+6,oy+5,3,20);ctx.fillRect(ox+10,oy+5,14,3);ctx.fillStyle='#4f8cba';ctx.fillRect(ox+26,oy+6,2,22)}
 if(t===8){for(let y=0;y<32;y+=8){ctx.fillStyle='#596773';ctx.fillRect(ox,oy+y,32,2);for(let x=0;x<32;x+=16){ctx.fillRect(ox+x+(y%8?8:0),oy+y,2,8)}}}
 if(t===9){for(let j=0;j<30;j++){ctx.fillStyle=j%2?'#bda176':'#8b7351';ctx.fillRect(ox+(rnd()*30|0),oy+(rnd()*30|0),3,3)}}
 if(t>=10&&t<=12){const col=['#292c33','#d79b68','#ffd45d'][t-10];for(let k=0;k<12;k++){ctx.fillStyle='#525a60';ctx.fillRect(ox+(rnd()*30|0),oy+(rnd()*30|0),5,5);ctx.fillStyle=col;ctx.fillRect(ox+(rnd()*27|0),oy+(rnd()*27|0),3,4)}}
 if(t===13){ctx.fillStyle='#6423a4';ctx.fillRect(ox+3,oy+3,26,26);for(let k=0;k<12;k++){ctx.fillStyle=k%2?'#b65bff':'#6ad6d6';ctx.fillRect(ox+(rnd()*28|0),oy+(rnd()*28|0),2,3)}}
 if(t===14){ctx.fillStyle='#f2c8a1';ctx.fillRect(ox+2,oy+2,28,28);ctx.fillStyle='#3c2c29';ctx.fillRect(ox+7,oy+13,4,4);ctx.fillRect(ox+21,oy+13,4,4);ctx.fillStyle='#b77d6a';ctx.fillRect(ox+13,oy+23,7,2)}
 if(t===15){ctx.fillStyle='#876037';ctx.fillRect(ox+2,oy+2,28,28);ctx.strokeStyle='#d1a068';ctx.lineWidth=3;ctx.strokeRect(ox+5,oy+5,22,22);ctx.fillStyle='#42372f';ctx.fillRect(ox+10,oy+10,12,12)}
 }
 let tex=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.generateMipmap(gl.TEXTURE_2D);return tex;}
const atlas=makeAtlas();gl.uniform1i(uni.atlas,0);
// AZURYX Neon 16x atlas (16 selected tiles from the user-supplied pack).
// Fallback texture remains playable if the image cannot load.
const imageAtlas=new Image();
imageAtlas.onload=()=>{
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,atlas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,imageAtlas);
  gl.generateMipmap(gl.TEXTURE_2D);
  window.BLOCKFUN_AZURYX_LOADED=true;
};
imageAtlas.onerror=()=>{console.warn('AZURYX atlas unavailable; using procedural backup')};
imageAtlas.src='./assets/blockfun-pack-atlas.png';
// Unique blocky player skins (our own pixel textures), separate from the crafting table atlas.
const skinTextures=new Array(6).fill(null);
for(let si=0;si<6;si++){
 const im=new Image();im.onload=()=>{
  const tex=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);skinTextures[si]=tex;
 };im.src='./assets/skins/skin'+si+'.png';
}

class Builder{constructor(){this.v=[];this.i=[]}
 quad(p,uv,t,sh=1){const j=this.v.length/7;for(let k=0;k<4;k++)this.v.push(p[k][0],p[k][1],p[k][2],uv[k][0],uv[k][1],t,sh);this.i.push(j,j+1,j+2,j,j+2,j+3)}
 top(x1,x2,z1,z2,y,t,sh=1){this.quad([[x1,y,z1],[x2,y,z1],[x2,y,z2],[x1,y,z2]],[[0,0],[x2-x1,0],[x2-x1,z2-z1],[0,z2-z1]],t,sh)}
 side(x1,y1,z1,x2,y2,z2,t,sh=.78){this.quad([[x1,y1,z1],[x2,y1,z2],[x2,y2,z2],[x1,y2,z1]],[[0,0],[Math.hypot(x2-x1,z2-z1),0],[Math.hypot(x2-x1,z2-z1),y2-y1],[0,y2-y1]],t,sh)}
 box(x,y,z,sx,sy,sz,t){let a=x-sx/2,b=x+sx/2,c=y-sy/2,d=y+sy/2,e=z-sz/2,f=z+sz/2;this.top(a,b,e,f,d,t,1);this.quad([[a,c,f],[b,c,f],[b,d,f],[a,d,f]],[[0,0],[sx,0],[sx,sy],[0,sy]],t,.88);this.quad([[b,c,e],[a,c,e],[a,d,e],[b,d,e]],[[0,0],[sx,0],[sx,sy],[0,sy]],t,.7);this.quad([[a,c,e],[a,c,f],[a,d,f],[a,d,e]],[[0,0],[sz,0],[sz,sy],[0,sy]],t,.75);this.quad([[b,c,f],[b,c,e],[b,d,e],[b,d,f]],[[0,0],[sz,0],[sz,sy],[0,sy]],t,.8)}
 box6(x,y,z,sx,sy,sz,topT,bottomT,frontT,backT,leftT,rightT){let a=x-sx/2,b=x+sx/2,c=y-sy/2,d=y+sy/2,e=z-sz/2,f=z+sz/2;
  this.top(a,b,e,f,d,topT,1);
  this.quad([[a,c,e],[b,c,e],[b,c,f],[a,c,f]],[[0,0],[sx,0],[sx,sz],[0,sz]],bottomT,.64);
  this.quad([[a,c,f],[b,c,f],[b,d,f],[a,d,f]],[[0,0],[sx,0],[sx,sy],[0,sy]],frontT,.88);
  this.quad([[b,c,e],[a,c,e],[a,d,e],[b,d,e]],[[0,0],[sx,0],[sx,sy],[0,sy]],backT,.70);
  this.quad([[a,c,e],[a,c,f],[a,d,f],[a,d,e]],[[0,0],[sz,0],[sz,sy],[0,sy]],leftT,.75);
  this.quad([[b,c,f],[b,c,e],[b,d,e],[b,d,f]],[[0,0],[sz,0],[sz,sy],[0,sy]],rightT,.80)}
}
function makeMesh(B){if(!B.i.length)return null;const m={vertex:gl.createBuffer(),index:gl.createBuffer(),count:B.i.length};gl.bindBuffer(gl.ARRAY_BUFFER,m.vertex);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(B.v),gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(B.i),gl.STATIC_DRAW);return m}
function release(m){if(!m)return;gl.deleteBuffer(m.vertex);gl.deleteBuffer(m.index)}
function drawMesh(m,dx=0,dy=0,dz=0,yaw=0){if(!m)return;gl.bindBuffer(gl.ARRAY_BUFFER,m.vertex);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.index);const s=7*4;gl.enableVertexAttribArray(attr.p);gl.vertexAttribPointer(attr.p,3,gl.FLOAT,false,s,0);gl.enableVertexAttribArray(attr.uv);gl.vertexAttribPointer(attr.uv,2,gl.FLOAT,false,s,12);gl.enableVertexAttribArray(attr.tile);gl.vertexAttribPointer(attr.tile,1,gl.FLOAT,false,s,20);gl.enableVertexAttribArray(attr.shade);gl.vertexAttribPointer(attr.shade,1,gl.FLOAT,false,s,24);gl.uniform3f(uni.offset,dx,dy,dz);gl.uniform1f(uni.yaw,yaw);gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0)}
const cellKey=(x,z)=>x+','+z;function state(x,z){return dig.get(cellKey(x,z))||0}function heightState(s){return s===0?0:s===1?-1:-2}function topAt(x,z){if(Math.abs(x)>=WORLD_HALF||Math.abs(z)>=WORLD_HALF)return -2;return heightState(state(Math.floor(x),Math.floor(z)))}
function chunkKey(cx,cz){return cx+','+cz}
function chunkMesh(cx,cz){let B=new Builder(),a=cx*CHUNK,b=cz*CHUNK;
 for(let z=b;z<b+CHUNK;z++){let x=a;while(x<a+CHUNK){let inside=Math.abs(x)<WORLD_HALF&&Math.abs(z)<WORLD_HALF;let s=inside?state(x,z):2,end=x+1;while(end<a+CHUNK){let in2=Math.abs(end)<WORLD_HALF&&Math.abs(z)<WORLD_HALF;let s2=in2?state(end,z):2;if(s2!==s)break;end++}if(s<2)B.top(x,end,z,z+1,heightState(s),s===0?0:2);x=end}}
 for(let z=b;z<b+CHUNK;z++)for(let x=a;x<a+CHUNK;x++){
  if(!(Math.abs(x)<WORLD_HALF&&Math.abs(z)<WORLD_HALF))continue;
  let s=state(x,z),h=heightState(s);if(s===2)continue;
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   let nx=x+dx,nz=z+dz; let nh=(Math.abs(nx)<WORLD_HALF&&Math.abs(nz)<WORLD_HALF)?heightState(state(nx,nz)):-2;
   if(nh>=h)continue;
   let x1=x+(dx===1?1:0),x2=x+(dx===-1?0:dx===1?1:1),z1=z+(dz===1?1:0),z2=z+(dz===-1?0:dz===1?1:1);
   if(dx!==0){x1=x2=x+(dx>0?1:0);z1=z;z2=z+1}else{z1=z2=z+(dz>0?1:0);x1=x;x2=x+1}
   if(s===0)B.side(x1,-1,z1,x2,0,z2,1);
   if(nh< -1)B.side(x1,-2,z1,x2,-1,z2,2)
  }
 }
 return makeMesh(B)}
let chunkCenterX=NaN,chunkCenterZ=NaN;function rebuildAroundCell(x,z){for(let zz=z-1;zz<=z+1;zz++)for(let xx=x-1;xx<=x+1;xx++){let k=chunkKey(Math.floor(xx/CHUNK),Math.floor(zz/CHUNK));if(chunks.has(k)){release(chunks.get(k));chunks.set(k,chunkMesh(Math.floor(xx/CHUNK),Math.floor(zz/CHUNK)))}}}
function updateChunks(){const cx=Math.floor(eye.x/CHUNK),cz=Math.floor(eye.z/CHUNK);if(cx===chunkCenterX&&cz===chunkCenterZ)return;chunkCenterX=cx;chunkCenterZ=cz;const wanted=new Set();for(let z=cz-RADIUS;z<=cz+RADIUS;z++)for(let x=cx-RADIUS;x<=cx+RADIUS;x++){const k=chunkKey(x,z);wanted.add(k);if(!chunks.has(k))chunks.set(k,chunkMesh(x,z))}for(const [k,m] of chunks)if(!wanted.has(k)){release(m);chunks.delete(k)}}
// Spatially-indexed AABB colliders: exact voxel-sized walls with real door gaps.
const solidBuckets=new Map(),solidBoxes=[],PHYS_RADIUS=.29,PHYS_HEIGHT=1.78,EYE_HEIGHT=1.62,STEP_HEIGHT=.55;
const bucketKey=(x,z)=>x+':'+z;
function addSolid(x,y,z,sx,sy,sz){
 const b={x1:x-sx/2,x2:x+sx/2,y1:y-sy/2,y2:y+sy/2,z1:z-sz/2,z2:z+sz/2};
 solidBoxes.push(b);
 for(let zz=Math.floor(b.z1/8);zz<=Math.floor(b.z2/8);zz++)for(let xx=Math.floor(b.x1/8);xx<=Math.floor(b.x2/8);xx++){
  const k=bucketKey(xx,zz);let a=solidBuckets.get(k);if(!a){a=[];solidBuckets.set(k,a)}a.push(b)
 }
 return b
}
function nearbySolids(x,z){const seen=new Set(),out=[];for(let zz=Math.floor((z-PHYS_RADIUS)/8);zz<=Math.floor((z+PHYS_RADIUS)/8);zz++)for(let xx=Math.floor((x-PHYS_RADIUS)/8);xx<=Math.floor((x+PHYS_RADIUS)/8);xx++){
 const arr=solidBuckets.get(bucketKey(xx,zz));if(arr)for(const b of arr)if(!seen.has(b)){seen.add(b);out.push(b)}
}return out}
function intersectBody(x,feet,z){const r=PHYS_RADIUS;for(const b of nearbySolids(x,z)){
 if(b.active===false)continue;
 if(x+r>b.x1+.001&&x-r<b.x2-.001&&z+r>b.z1+.001&&z-r<b.z2-.001&&feet+PHYS_HEIGHT>b.y1+.015&&feet<b.y2-.018)return true
}return false}
function topSupport(x,z,upper,lower){let best=-Infinity;
 const ground=topAt(x,z);if(ground>=lower-.03&&ground<=upper+.03)best=ground;
 for(const b of nearbySolids(x,z))if(b.active!==false&&x+PHYS_RADIUS>b.x1+.001&&x-PHYS_RADIUS<b.x2-.001&&z+PHYS_RADIUS>b.z1+.001&&z-PHYS_RADIUS<b.z2-.001&&b.y2>=lower-.03&&b.y2<=upper+.03)best=Math.max(best,b.y2);
 return best
}
function tryMoveAxis(nx,nz){let feet=eye.y-EYE_HEIGHT;
 if(!intersectBody(nx,feet,nz)){eye.x=nx;eye.z=nz;return true}
 // Standard Minecraft-like step-up: don't walk through walls, only mount low blocks.
 const surface=topSupport(nx,nz,feet+STEP_HEIGHT,feet+.025);
 if(Number.isFinite(surface)&&surface>feet+.025&&surface<=feet+STEP_HEIGHT&&!intersectBody(nx,surface+.022,nz)){
  eye.x=nx;eye.z=nz;eye.y=surface+EYE_HEIGHT+.023;eye.vy=0;eye.ground=true;return true
 }
 return false
}
// House / protected spawn geometry batched into a single WebGL draw.
const seats=[];let seated=null;
function constructSpawn(){let B=new Builder();
 const S=(x,y,z,sx,sy,sz,t)=>{B.box(x,y,z,sx,sy,sz,t);addSolid(x,y,z,sx,sy,sz)};
 const D=(x,y,z,sx,sy,sz,t)=>B.box(x,y,z,sx,sy,sz,t);
 const C=(x,y,z)=>{B.box6(x,y,z,1,1,1,15,5,14,14,14,14);addSolid(x,y,z,1,1,1)};
 // Minecraft survival aesthetic: one real cottage, stone paths, low fence and four corner lamps.
 // Path tiles are decorative only and never create invisible collision walls.
 D(0,.035,1,3,.07,77,9);D(0,.037,4,71,.07,3,9);
 D(0,.060,2,11,.105,11,8); // cobble landing in the middle
 for(const [x,z] of [[-39,-39],[39,-39],[-39,39],[39,39]]){
  S(x,.57,z,1,1.1,1,8);S(x,1.53,z,.7,.8,.7,5);D(x,2.08,z,1.1,.35,1.1,11);
 }
 // Full stone safety border: 1 block high so players do not fall into the void outside the 100x100 spawn.
 for(let x=-49;x<=49;x++){S(x,.5,-49,1,1,1,8);S(x,.5,49,1,1,1,8);addSolid(x,.5,-49,1,1,1);addSolid(x,.5,49,1,1,1)}
 for(let z=-48;z<=48;z++){S(-49,.5,z,1,1,1,8);S(49,.5,z,1,1,1,8);addSolid(-49,.5,z,1,1,1);addSolid(49,.5,z,1,1,1)}
 // Cobblestone foundation and a step-up porch, both physically walkable.
 // Raised slightly and with an interior finish floor so grass never peeks through the walls.
 S(0,.18,-19,17,.36,15,8);
 S(0,.16,-10,6,.32,3,4);
 S(0,.62,-19,14.9,.44,12.9,8); // raised stone floor hides any green seams under the house
 D(0,.62,-25,15.0,.50,.70,8); D(0,.62,-13,15.0,.50,.70,8); // front/back stone skirting
 D(-7,.62,-19,.70,.50,12.2,8); D(7,.62,-19,.70,.50,12.2,8); // side stone skirting
 // Oak pillars and wall blocks form the real house shape: 3-block door gap in front.
 // house spans x[-7,+7], z[-25,-13], with the door at z=-12.5.
 for(const x of [-7,7])for(const z of [-25,-13])for(let y=1;y<=4;y++)S(x,y+.25,z,1,1,1,5);
 for(let z=-24;z<=-14;z++)for(let y=1;y<=4;y++){
   if(y===2&&(z===-19||z===-20)){S(-7,y+.25,z,1,1,1,7);S(7,y+.25,z,1,1,1,7)}
   else {S(-7,y+.25,z,1,1,1,4);S(7,y+.25,z,1,1,1,4)}
 }
 for(let x=-6;x<=6;x++)for(let y=1;y<=4;y++){
  // Doorway on front: x=-1..1, y=1..3 are empty so you can actually ENTER.
  if(!(Math.abs(x)<=1&&y<=3))S(x,y+.25,-13,1,1,1,(y===2&&Math.abs(x)===4)?7:4);
  S(x,y+.25,-25,1,1,1,(y===2&&(x===-4||x===4))?7:4);
 }
 // Solid-but-thin wooden door surround (no invisible full doorway collider).
 S(-2.15,1.78,-12.42,.28,3.10,.32,5);S(2.15,1.78,-12.42,.28,3.10,.32,5);
 S(0,3.42,-12.42,4.6,.3,.32,5);
 // Minecraft gabled roof: stepped dark timber shingles, separate actual solid voxels.
 // Roof is solid if someone jumps onto it; no ghost blocks above the player.
 for(let x=-9;x<=9;x++){
  const ry=5.05+Math.max(0,9-Math.abs(x))*.34;
  for(let z=-27;z<=-11;z++)S(x,ry,z,1,.65,1,6);
 }
 // Close the gables: in earlier builds the roof had see-through sky gaps.
 for(const z of [-25,-13])for(let x=-7;x<=7;x++){
  const roofBase=5.05+Math.max(0,9-Math.abs(x))*.34-.325;
  for(let y=5.25;y+.48<roofBase;y+=1){
   S(x,y,z,1,1,1,(x===0&&Math.abs(y-6.25)<.1)?7:4);
  }
 }
 // roof ridge beams and eaves
 S(0,8.50,-19,1.1,.35,18,5);
 for(const z of [-27,-11])D(0,5.15,z,17,.18,.2,5);
 // A 2-step walkable porch and oak-decorated inside, Minecraft-like crafting cabin.
 S(0,.28,-11.1,3.6,.40,1.7,4);
 C(0,1.34,-18.8); // crafting table with Minecraft-like top and side textures
 // Four clear chairs: thin seat, four legs and a tall backrest.
 for(const [x,z,dx,dz] of [[-3,-18.8,-1,0],[3,-18.8,1,0],[0,-21.8,0,-1],[0,-15.8,0,1]]){
  S(x,1.00,z,1.2,.34,1.2,5);
  for(const [lx,lz] of [[-.42,-.42],[.42,-.42],[-.42,.42],[.42,.42]])S(x+lx,.69,z+lz,.16,.62,.16,5);
  S(x+dx*.43,1.72,z+dz*.43,1.02,1.5,.22,5);
  seats.push({x,z,top:1.17,dx,dz});
 }
 S(-4.5,1.34,-22,2,1,1,5);S(4.5,1.34,-22,2,1,1,5); // full-block benches
 // four lantern stands on the plaza path
 for(const [x,z] of [[-6,-6],[6,-6],[-6,9],[6,9]]){S(x,1,z,.8,2,.8,5);D(x,2.33,z,1.1,.45,1.1,11)}
 // Block displays near house with the texture pack, without giant constructions.
 for(const [x,z,t] of [[-12,-12,8],[-14,-12,5],[12,-12,8],[14,-12,4]])S(x,.5,z,1,1,1,t);
 // Small portal using actual solid frame and non-solid animated-looking infill.
 D(24,.09,15,7,.16,7,8);
 for(let y=1;y<=5;y++){S(22,y-.5,15,1,1,1,3);S(26,y-.5,15,1,1,1,3)}
 for(let x=22;x<=26;x++){S(x,5.5,15,1,1,1,3);S(x,.50,15,1,1,1,3)}
 D(24,2.62,15,2.7,4,.2,13);
 // Simple stone plinth on the far path, visibly solid.
 S(-24,.32,15,7,.64,6,8); S(-24,.99,15,1.7,.7,1.7,11);
 return makeMesh(B)
}
const spawnMesh=constructSpawn();
const quarry={x:-23,z:69};
const oreNodes=[[-27,67,10],[-20,70,11],[-25,72,12],[-18,66,10],[-22,65,11]].map(([x,z,t])=>({x,z,t,alive:true,collider:null}));
let quarryStaticsAdded=false;
function buildQuarry(){let B=new Builder();const first=!quarryStaticsAdded;
 function rock(x,y,z,sx,sy,sz,t=3){B.box(x,y,z,sx,sy,sz,t);if(first)addSolid(x,y,z,sx,sy,sz)}
 B.box(-23,.09,69,12,.18,12,9);
 for(let z=65;z<=73;z+=2)for(let x=-28;x<=-18;x+=2)if((x+z)%3===0)rock(x,.46,z,1,.9,1);
 for(const node of oreNodes)if(node.alive){B.box(node.x,1.25,node.z,1.2,1.5,1.2,node.t);if(!node.collider)node.collider=addSolid(node.x,1.25,node.z,1.2,1.5,1.2)}
 rock(-23,2.5,62,9,.8,1,8);rock(-27,1,62,1,2,1,8);rock(-19,1,62,1,2,1,8);
 quarryStaticsAdded=true;return makeMesh(B)
}
let quarryMesh=buildQuarry();
function playerName(n){return String(n||'Miner').replace(/[^\p{L}\p{N} _.-]/gu,'').slice(0,18)||'Miner'}
function formatGrid(){
 const labels={grass:['▧','Grass'],dirt:['▣','Dirt'],stone:['▦','Stone'],ore:['◆','Ore']};
 const bar=$('hotbar'),invGrid=$('inventoryGrid'),invBar=$('inventoryHotbar');
 bar.replaceChildren();invGrid.replaceChildren();invBar.replaceChildren();
 const renderSlot=(key,i,forInventory)=>{
  const btn=document.createElement('button');btn.type='button';btn.className=forInventory?'item'+(selectedSlot===i?' active':''):'slot'+(selectedSlot===i?' active':'')+(key?'':' empty');
  if(key)btn.dataset.type=key;
  btn.title=(i+1)+' - '+(key?labels[key][1]:'Empty');
  let index=document.createElement('span');index.className=forInventory?'invHotbarIndex':'slotNum';index.textContent=String(i+1);btn.append(index);
  let icon=document.createElement('span');icon.className=forInventory?'mcItemIcon':'slotIcon';icon.textContent=key?labels[key][0]:'';btn.append(icon);
  let count=document.createElement('small');count.className=forInventory?'mcItemCount':'slotCount';count.textContent=key&&inv[key]?String(inv[key]):'';btn.append(count);
  btn.onclick=()=>selectSlot(i);return btn;
 };
 hotbarSlots.forEach((key,i)=>{bar.append(renderSlot(key,i,false));invBar.append(renderSlot(key,i,true))});
 for(let i=0;i<27;i++){let empty=document.createElement('div');empty.className='item';empty.setAttribute('aria-label','Empty inventory slot');invGrid.append(empty)}
}
function selectSlot(i){selectedSlot=(i+9)%9;selected=hotbarSlots[selectedSlot]||null;formatGrid()}
// --- Camera matrices ---
function persp(fov,aspect,near,far){const f=1/Math.tan(fov/2),o=new Float32Array(16);o[0]=f/aspect;o[5]=f;o[10]=(far+near)/(near-far);o[11]=-1;o[14]=2*far*near/(near-far);return o}
function normalize(a){const n=Math.hypot(...a)||1;return a.map(v=>v/n)}
function lookAt(ex,ey,ez,tx,ty,tz){const z=normalize([ex-tx,ey-ty,ez-tz]),x=normalize([z[2],0,-z[0]]),y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-(x[0]*ex+x[1]*ey+x[2]*ez),-(y[0]*ex+y[1]*ey+y[2]*ez),-(z[0]*ex+z[1]*ey+z[2]*ez),1])}
function mul(A,B){const o=new Float32Array(16);for(let col=0;col<4;col++)for(let row=0;row<4;row++){let n=0;for(let k=0;k<4;k++)n+=A[k*4+row]*B[col*4+k];o[col*4+row]=n}return o}
let viewProj=null;
const avatarCache=new Map();
function avatarModel(skin,frame){
 let B=new Builder(),phase=Math.sin(frame*Math.PI/4),a=phase*.55;
 // Real leg/arm swing around hip/shoulder; shape stays blocky like Minecraft.
 function limb(x,y,z,sx,sy,sz,tex,angle,pivotY){
  const from=B.v.length;
  B.box(x,y,z,sx,sy,sz,tex);
  const co=Math.cos(angle),sn=Math.sin(angle);
  for(let j=from;j<B.v.length;j+=7){const dy=B.v[j+1]-pivotY,dz=B.v[j+2];B.v[j+1]=pivotY+dy*co-dz*sn;B.v[j+2]=dy*sn+dz*co;}
 }
 B.box6(0,1.14,0,.56,.74,.31,4,4,3,4,5,5);
 B.box6(0,1.79,0,.47,.48,.46,2,1,0,1,1,1);
 limb(-.18,.46,0,.22,.92,.26,7,a,.88);limb(.18,.46,0,.22,.92,.26,7,-a,.88);
 limb(-.44,1.15,0,.20,.71,.24,5,-a,1.49);limb(.44,1.15,0,.20,.71,.24,5,a,1.49);
 B.box(-.18,.075,.06+Math.sin(a)*.10,.22,.15,.28,8);
 B.box(.18,.075,.06-Math.sin(a)*.10,.22,.15,.28,8);
 return makeMesh(B)
}
function getAvatarMesh(skin,frame){const key=skin+':'+frame;if(!avatarCache.has(key))avatarCache.set(key,avatarModel(skin,frame));return avatarCache.get(key)}
function addChat(name,message,self=false){let log=$('chatLog'),l=document.createElement('div');l.className='chatMsg';let b=document.createElement('b');b.textContent=name+': ';l.append(b,document.createTextNode(message));log.append(l);while(log.children.length>45)log.firstChild.remove();log.scrollTop=log.scrollHeight;let p=document.createElement('div');p.textContent=name+': '+message;$('chatPreview').append(p);while($('chatPreview').children.length>3)$('chatPreview').firstChild.remove()}
const player={name:'Miner',skin:Math.floor(Math.random()*6)};
function updatePreviewSkin(){
 const pv=document.querySelector('.playerPreview'),hand=$('handOverlay');
 const colors=[['#3f8b91','#e0aa7e','#5a3428'],['#659b43','#f0c19a','#392c26'],['#3b64a4','#b77b57','#271d20'],['#8c4a81','#e2b5a0','#9c632e'],['#9d593f','#c58a62','#2e2521'],['#61717c','#efbc95','#b38a56']];
 const [shirt,skin,hair]=colors[player.skin%colors.length];
 if(pv){pv.style.setProperty('--shirt',shirt);pv.style.setProperty('--sleeve',shirt);pv.style.setProperty('--skin',skin);pv.style.setProperty('--hair',hair)}
 if(hand)hand.src='./assets/skins/arm'+(player.skin%6)+'.png';
}
const playerTags=new Map();let lastTagUpdate=0;
function showPlayerTags(now,vp){
 if(now-lastTagUpdate<240)return;lastTagUpdate=now;
 for(const [id,tag] of playerTags)if(!remotes.has(id)){tag.remove();playerTags.delete(id)}
 for(const [id,p] of remotes){
  let tag=playerTags.get(id);if(!tag){tag=document.createElement('div');tag.className='remoteTag';document.body.append(tag);playerTags.set(id,tag)}
  tag.textContent=playerName(p.name||'Guest');
  const x=p.x,y=p.y+.75,z=p.z;const w=vp[3]*x+vp[7]*y+vp[11]*z+vp[15];
  if(w<=.1){tag.style.display='none';continue}
  const sx=(vp[0]*x+vp[4]*y+vp[8]*z+vp[12])/w;
  const sy=(vp[1]*x+vp[5]*y+vp[9]*z+vp[13])/w;
  if(Math.abs(sx)>1.25||Math.abs(sy)>1.25){tag.style.display='none';continue}
  tag.style.display='block';tag.style.left=((sx+.999)/2*innerWidth)+'px';tag.style.top=((1-sy)/2*innerHeight)+'px';
 }
}
function connect(){let u=window.BLOCKFUN_WS_URL;if(!u||!u.startsWith('wss://')){$('online').textContent='● SERVER NOT SET';return;}let ws;try{ws=new WebSocket(u)}catch{return}net.ws=ws;$('online').textContent='◌ CONNECTING';ws.onopen=()=>{if(net.ws!==ws)return;net.connected=true;net.retry=0;$('online').textContent='● ONLINE';ws.send(JSON.stringify({t:'profile',name:player.name,skin:player.skin}))};ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}
 if(m.t==='hello'){net.id=m.id;remotes.clear();for(const p of (m.players||[]))if(p.id!==net.id)remotes.set(p.id,{...p,targetX:p.x,targetY:p.y,targetZ:p.z,at:performance.now()});$('online').textContent=`● ${remotes.size+1} ONLINE`;for(const q of (m.history||[]))addChat(q.name,q.text)}
 if(m.t==='join'&&m.id!==net.id){remotes.set(m.id,{...m,targetX:m.x,targetY:m.y,targetZ:m.z,at:performance.now()});$('online').textContent=`● ${remotes.size+1} ONLINE`}
 if(m.t==='move'&&remotes.has(m.id)){let p=remotes.get(m.id);p.targetX=m.x;p.targetY=m.y;p.targetZ=m.z;p.yaw=m.yaw;p.moving=m.moving}
 if(m.t==='profile'&&remotes.has(m.id)){let p=remotes.get(m.id);p.name=m.name||p.name;p.skin=m.skin??p.skin}
 if(m.t==='leave'){remotes.delete(m.id);$('online').textContent=`● ${remotes.size+1} ONLINE`}
 if(m.t==='chat')addChat(m.name||'Guest',m.text||'');
 if(m.t==='patch'&&Number.isFinite(m.x)&&Number.isFinite(m.z)&&(Math.abs(m.x)>=50||Math.abs(m.z)>=50)){if(m.action==='break'){dig.set(cellKey(m.x,m.z),m.y===0?1:2);rebuildAroundCell(m.x,m.z)}else if(m.action==='place'){if(m.y===0)dig.delete(cellKey(m.x,m.z));else dig.set(cellKey(m.x,m.z),1);rebuildAroundCell(m.x,m.z)}}
 };ws.onclose=()=>{if(net.ws!==ws)return;net.connected=false;$('online').textContent='● OFFLINE';remotes.clear();net.retry++;setTimeout(connect,Math.min(12000,3000+net.retry*750))};ws.onerror=()=>{if(net.ws===ws&&!net.connected)$('online').textContent='◌ RETRYING';};}
connect();
window.addEventListener('online',()=>{if(!net.connected && (!net.ws || net.ws.readyState!==WebSocket.CONNECTING))connect()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && !net.connected && (!net.ws || net.ws.readyState!==WebSocket.CONNECTING))connect()});
function send(message){if(net.ws?.readyState===WebSocket.OPEN)net.ws.send(JSON.stringify(message))}
const controls={forward:0,strafe:0,joystick:false};let touchId=null;
const stick=$('joystick'),knob=$('knob');function stickMove(e){const r=stick.getBoundingClientRect();let x=e.clientX-(r.left+r.width/2),y=e.clientY-(r.top+r.height/2);let radius=r.width*.29,mag=Math.hypot(x,y);if(mag>radius){x*=radius/mag;y*=radius/mag}controls.forward=-y/radius;controls.strafe=x/radius;knob.style.transform=`translate(${x}px,${y}px)`}
stick.onpointerdown=e=>{e.preventDefault();touchId=e.pointerId;controls.joystick=true;stick.setPointerCapture(touchId);stickMove(e)};stick.onpointermove=e=>{if(e.pointerId===touchId)stickMove(e)};function stickEnd(e){if(e.pointerId!==touchId)return;controls.joystick=false;controls.forward=controls.strafe=0;touchId=null;knob.style.transform='translate(0,0)'}stick.onpointerup=stickEnd;stick.onpointercancel=stickEnd;
let tapOriginX=0,tapOriginY=0,tapMoved=false;canvas.addEventListener('pointerdown',e=>{if(!playing||typing)return;lookPointer=e.pointerId;tapOriginX=lastLookX=e.clientX;tapOriginY=lastLookY=e.clientY;tapMoved=false;canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{if(lookPointer!==e.pointerId||!playing)return;let dx=e.clientX-lastLookX,dy=e.clientY-lastLookY;lastLookX=e.clientX;lastLookY=e.clientY;if(Math.hypot(e.clientX-tapOriginX,e.clientY-tapOriginY)>10)tapMoved=true;eye.yaw-=dx*.0045;eye.pitch=Math.max(-1.25,Math.min(1.25,eye.pitch-dy*.0037))});canvas.addEventListener('pointerup',e=>{if(e.pointerId===lookPointer){lookPointer=null;if(!tapMoved&&!seated&&(lookedSeat()||isNearCraft()&&isLookingAtCraft()))interact()}});canvas.addEventListener('pointercancel',e=>{if(e.pointerId===lookPointer)lookPointer=null});canvas.oncontextmenu=e=>{e.preventDefault();if(playing&&!typing)interact()};
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;keys[e.code]=true;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(!playing)return;if(e.code==='KeyE'){toggle('inventoryPanel');return}if(e.code==='KeyT'){toggle('chatPanel');return}if(e.code==='KeyR'){interact();return}if(e.code==='Escape'){for(const el of document.querySelectorAll('.panel'))el.classList.add('hidden');if($('spawnPopup'))$('spawnPopup').classList.add('hidden');typing=false;return}if(e.code==='KeyF'){mine();return}if(e.code==='KeyP'){place();return}if(e.code==='KeyI'){toggle('inventoryPanel');return}if(e.code==='Digit1'||e.code==='Digit2'||e.code==='Digit3'||e.code==='Digit4'||e.code==='Digit5'||e.code==='Digit6'||e.code==='Digit7'||e.code==='Digit8'||e.code==='Digit9'){selectSlot(Number(e.code.replace('Digit',''))-1);return}});window.addEventListener('keyup',e=>keys[e.code]=false);window.addEventListener('blur',()=>{for(const k in keys)keys[k]=false});
$('jumpBtn').onpointerdown=e=>{e.preventDefault();keys.Space=true};$('jumpBtn').onpointerup=()=>keys.Space=false;$('jumpBtn').onpointercancel=()=>keys.Space=false;
function toggle(id,open){for(const p of document.querySelectorAll('.panel'))if(p.id!==id)p.classList.add('hidden');const el=$(id),show=open??el.classList.contains('hidden');el.classList.toggle('hidden',!show);typing=show&&id==='chatPanel';if(typing)$('chatInput').focus()}
for(const btn of document.querySelectorAll('[data-close]'))btn.onclick=()=>toggle(btn.dataset.close,false);
$('chatBtn').onclick=()=>toggle('chatPanel');$('inventoryBtn').onclick=()=>toggle('inventoryPanel');$('menuBtn').onclick=()=>toggle('menuPanel');$('mineBtn').onclick=mine;$('placeBtn').onclick=place;$('useBtn').onclick=interact;$('stayBtn').onclick=()=>toggle('spawnPopup',false);
$('chatForm').onsubmit=e=>{e.preventDefault();const t=$('chatInput').value.trim();if(!t)return;if(net.connected)send({t:'chat',text:t});else addChat(player.name,t);$('chatInput').value=''};
$('respawnBtn').onclick=()=>{eye.x=0;eye.z=14;eye.y=EYE_HEIGHT;eye.vy=0;toggle('menuPanel',false);toast('Returned to spawn')};
$('qualityBtn').onclick=()=>{quality=quality>.9?.72:1;resize();$('qualityBtn').textContent='Graphics: '+(quality<.9?'Max FPS':'Normal')};
function protectedZone(x,z){return Math.abs(x)<SAFE_HALF&&Math.abs(z)<SAFE_HALF}
function groundTarget(){let dir=rayForward(),best=null;for(let t=.7;t<5.5;t+=.22){let x=eye.x+dir.x*t,y=eye.y+dir.y*t,z=eye.z+dir.z*t,ix=Math.floor(x),iz=Math.floor(z),h=topAt(x,z);if(h>-2&&y<=h+.12){best={x:ix,z:iz,h};break}}if(!best){let x=eye.x+dir.x*2.8,z=eye.z+dir.z*2.8;best={x:Math.floor(x),z:Math.floor(z),h:topAt(x,z)}}return best}
function mine(){if(!playing)return;let nearby=oreNodes.find(p=>p.alive&&Math.hypot(p.x-eye.x,p.z-eye.z)<4);if(nearby){nearby.alive=false;if(nearby.collider)nearby.collider.active=false;release(quarryMesh);quarryMesh=buildQuarry();inv.ore++;formatGrid();toast('Ore collected (+1)');return}const t=groundTarget();if(protectedZone(t.x,t.z)){toast('Protected spawn: you cannot break blocks here');return}if(Math.abs(t.x)>=500||Math.abs(t.z)>=500)return;let s=state(t.x,t.z);if(s===0){dig.set(cellKey(t.x,t.z),1);inv.grass++;toast('+1 grass block')}else if(s===1){dig.set(cellKey(t.x,t.z),2);inv.dirt++;toast('+1 dirt block · you reached the bottom layer (2 layers)')}else{toast('There are no more layers to mine here');return}formatGrid();rebuildAroundCell(t.x,t.z);send({t:'edit',action:'break',x:t.x,y:s===0?0:-1,z:t.z,block:s===0?'grass':'dirt'})}
function place(){if(!playing)return;const t=groundTarget();if(protectedZone(t.x,t.z)){toast('Protected spawn');return}if(!selected){toast('Select a hotbar slot first');return}if(!['grass','dirt'].includes(selected)){toast('You can only place dirt and grass');return}if(inv[selected]<1){toast('You do not have any '+selected+' blocks');return}let s=state(t.x,t.z);if(s===2){dig.set(cellKey(t.x,t.z),1)}else if(s===1){dig.delete(cellKey(t.x,t.z))}else{toast('This ground already has 2 layers');return}inv[selected]--;formatGrid();rebuildAroundCell(t.x,t.z);toast('Block placed');send({t:'edit',action:'place',x:t.x,y:s===2?-1:0,z:t.z,block:selected})}
function isNearCraft(){return Math.hypot(eye.x,eye.z+18.8)<7.4}
function isLookingAtCraft(){
 const dir=rayForward(),box=[[-.5,.5],[.84,1.84],[-19.3,-18.3]],origin=[eye.x,eye.y,eye.z],v=[dir.x,dir.y,dir.z];
 let enter=0,exit=6.5;
 for(let i=0;i<3;i++){
  if(Math.abs(v[i])<.00001){if(origin[i]<box[i][0]||origin[i]>box[i][1])return false;continue}
  let a=(box[i][0]-origin[i])/v[i],b=(box[i][1]-origin[i])/v[i];if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);exit=Math.min(exit,b);if(exit<enter)return false;
 }
 return true
}
function rayHitsBox(box){const dir=rayForward(),origin=[eye.x,eye.y,eye.z],v=[dir.x,dir.y,dir.z];let enter=.05,exit=6.5;for(let i=0;i<3;i++){if(Math.abs(v[i])<.00001){if(origin[i]<box[i][0]||origin[i]>box[i][1])return false;continue}let a=(box[i][0]-origin[i])/v[i],b=(box[i][1]-origin[i])/v[i];if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);exit=Math.min(exit,b);if(exit<enter)return false}return true}
function lookedSeat(){let best=null;for(const s of seats){const d=Math.hypot(eye.x-s.x,eye.z-s.z);if(d<2.25&&rayHitsBox([[s.x-.75,s.x+.75],[.42,2.45],[s.z-.75,s.z+.75]])&&(!best||d<best.d))best={s,d}}return best}
function leaveSeat(){const s=seated,candidates=[[s.x+s.dz*1.55,s.z-s.dx*1.55],[s.x-s.dz*1.55,s.z+s.dx*1.55],[s.x-s.dx*1.65,s.z-s.dz*1.65]];let spot=candidates.find(([x,z])=>!intersectBody(x,.86,z))||[0,14];const support=topSupport(spot[0],spot[1],2.1,-.2);eye.x=spot[0];eye.z=spot[1];eye.y=(Number.isFinite(support)?support:0)+EYE_HEIGHT+.03;eye.vy=0;eye.ground=true;seated=null;toast('Standing up')}
function openCraft(){if(!playing)return;toggle('craftPanel',true);updateCraftLeft()}
function interact(){
 if(seated){leaveSeat();return}
 const targetSeat=lookedSeat();if(targetSeat){seated=targetSeat.s;eye.x=seated.x-seated.dx*.24;eye.z=seated.z-seated.dz*.24;eye.y=seated.top+.95;eye.vy=0;eye.ground=true;for(const k in keys)keys[k]=false;toast('Seated');return}
 if(isNearCraft()&&isLookingAtCraft()){openCraft();return}
 if(Math.hypot(eye.x-24,eye.z-15)<5){openMarket();return}
 if(Math.hypot(eye.x-quarry.x,eye.z-quarry.z)<9){toast('Peaceful quarry: tap MINE to collect ore');return}
 toast('Look at a chair or the crafting table, then press R.')
}
$('craftPrompt').onclick=openCraft;
let crafted=[];function readCraft(){try{let s=JSON.parse(localStorage.getItem('blockfun-craft-final')||'{}');return s.day===new Date().toISOString().slice(0,10)?s:{day:new Date().toISOString().slice(0,10),items:[]}}catch{return {day:new Date().toISOString().slice(0,10),items:[]}}}let craftState=readCraft();function updateCraftLeft(){$('craftLeft').textContent=(3-craftState.items.length)+' crafts left';$('craftButton').disabled=craftState.items.length>=3}updateCraftLeft();
const coinEndpoint=(window.BLOCKFUN_COIN_API_URL||'').replace(/\/$/,'');
$('mintStatus').textContent=coinEndpoint?'SERVER CONNECTED · CHECKING':'DEMO ONLY · NOT ONCHAIN';
$('tokenImage').onchange=()=>{
 const f=$('tokenImage').files?.[0],prev=$('coinImagePreview');prev.replaceChildren();
 if(f&&f.size>160000){toast('Logo too large: maximum 160 KB');$('tokenImage').value='';return}
 if(f){const img=document.createElement('img');img.alt='Coin logo preview';img.src=URL.createObjectURL(f);img.onload=()=>URL.revokeObjectURL(img.src);prev.append(img)}
};
async function readTokenLogo(){
 const file=$('tokenImage').files?.[0];if(!file)return '';
 if(file.size>160000)throw Error('Logo maximum 160 KB');
 return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Logo read failed'));r.readAsDataURL(file)})
}
$('craftButton').onclick=async()=>{
 craftState=readCraft();let name=$('tokenName').value.trim(),ticker=$('tokenTicker').value.trim().toUpperCase(),theme=$('tokenTheme').value.trim(),supply=$('tokenSupply').value.trim(),x=$('tokenX').value.trim(),website=$('tokenWebsite').value.trim(),story=$('tokenStory').value.trim();
 if(name.length<2||name.length>32||!/^[A-Z0-9]{2,10}$/.test(ticker)){toast('Name: 2-32 characters. Ticker: 2-10 letters/numbers.');return}
 if(craftState.items.length>=3){toast('Daily demo limit: 3 coins');return}
 let logo='';try{logo=await readTokenLogo()}catch(e){toast(e.message);return}
 const payload={name,ticker,theme,supply,x,website,story,logo};
 $('craftButton').disabled=true;$('craftButton').textContent=coinEndpoint?'SUBMITTING...':'CREATING...';
 try{
  let coin;
  if(coinEndpoint){
   // This requires a real operator-managed backend; do not put signing secrets in browser code.
   const response=await fetch(coinEndpoint+'/api/coins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Mint server refused request');
   if(!data.mint||!data.signature||data.status!=='confirmed')throw Error('Mint unconfirmed by the server — no coin was created');
   coin={...payload,logo,mint:data.mint,signature:data.signature,mode:'onchain',createdAt:Date.now()};
  } else coin={...payload,mode:'demo',createdAt:Date.now()};
  craftState.items.push(coin);localStorage.setItem('blockfun-craft-final',JSON.stringify(craftState));updateCraftLeft();
  toast(coin.mode==='onchain'?'On-chain token confirmed!':'Demo coin created! (not on-chain)');
  for(const id of ['tokenName','tokenTicker','tokenTheme','tokenSupply','tokenX','tokenWebsite','tokenStory','tokenImage'])$(id).value='';$('coinImagePreview').replaceChildren();
  toggle('craftPanel',false);openMarket();
 }catch(e){toast(String(e.message||e).slice(0,120));}
 finally{$('craftButton').disabled=false;$('craftButton').textContent=coinEndpoint?'CREATE REAL COIN':'CREATE DEMO COIN';updateCraftLeft()}
};
if(coinEndpoint)$('craftButton').textContent='CREATE REAL COIN';
function openMarket(){
 const list=$('marketList');list.replaceChildren();const cs=readCraft().items;
 if(!cs.length)list.textContent='No coins created yet. Visit the crafting table.';
 for(const c of cs){
  const el=document.createElement('div');el.className='coinCard';
  if(c.logo){const img=document.createElement('img');img.src=c.logo;img.alt='Coin logo';el.append(img)}
  const hd=document.createElement('b');hd.textContent=c.name+' ($'+c.ticker+')';el.append(hd);
  const sub=document.createElement('small');sub.style.display='block';sub.textContent=(c.mode==='onchain'?'ONCHAIN · VERIFIED':'DEMO · NOT ONCHAIN')+' · '+(c.theme||'Meme');el.append(sub);
  if(c.story){const text=document.createElement('p');text.textContent=c.story;el.append(text)}
  if(c.mode==='onchain'&&c.mint){const link=document.createElement('a');link.href='https://pump.fun/coin/'+encodeURIComponent(c.mint);link.textContent='VIEW ON PUMP.FUN';link.target='_blank';link.rel='noopener noreferrer';el.append(link)}
  list.append(el)
 }
 toggle('marketPanel',true)
}
function start(){if(playing)return;playing=true;player.name=playerName($('nick').value);selectedSlot=0;selected=hotbarSlots[0];updatePreviewSkin();$('start').style.display='none';$('hud').hidden=false;send({t:'profile',name:player.name,skin:player.skin});toggle('spawnPopup',true);toast('E inventory · T chat · R use · 1-9 slots');formatGrid()}
formatGrid();updatePreviewSkin();
window.BLOCKFUN_START=start;window.BLOCKFUN_READY=true;window.dispatchEvent(new Event('blockfun-ready'));
function resize(){const w=window.innerWidth,h=window.innerHeight;canvas.width=Math.max(1,Math.round(w*quality));canvas.height=Math.max(1,Math.round(h*quality));canvas.style.width=w+'px';canvas.style.height=h+'px';gl.viewport(0,0,canvas.width,canvas.height)}resize();window.addEventListener('resize',resize);
// Main loop: small viewport, ~25 chunk draw calls, no lighting shadows or trees.
function tick(now){requestAnimationFrame(tick);const dt=Math.min(.045,(now-lastFrame)/1000);lastFrame=now;
 if(seated&&(keys.KeyW||keys.KeyA||keys.KeyS||keys.KeyD||keys.Space||controls.forward||controls.strafe))leaveSeat();
 if(playing&&!typing){let f=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0)+controls.forward,s=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0)+controls.strafe;let n=Math.max(1,Math.hypot(f,s)),speed=5.4*dt;let nx=eye.x+(-Math.sin(eye.yaw)*f+Math.cos(eye.yaw)*s)/n*speed,nz=eye.z+(-Math.cos(eye.yaw)*f-Math.sin(eye.yaw)*s)/n*speed;
 if(Math.abs(nx)<WORLD_HALF-1)tryMoveAxis(nx,eye.z);
 if(Math.abs(nz)<WORLD_HALF-1)tryMoveAxis(eye.x,nz);
 if(keys.Space&&eye.ground){eye.vy=6.3;eye.ground=false}
 let oldFeet=eye.y-EYE_HEIGHT;
 eye.vy-=17.5*dt;let newFeet=oldFeet+eye.vy*dt;
 if(eye.vy>0){
  if(intersectBody(eye.x,newFeet,eye.z)){eye.vy=0;newFeet=oldFeet}
  eye.ground=false;
 }else{
  const support=topSupport(eye.x,eye.z,oldFeet+STEP_HEIGHT,newFeet-.04);
  if(Number.isFinite(support)&&newFeet<=support&&oldFeet>=support-.11){newFeet=support;eye.vy=0;eye.ground=true}
  else eye.ground=false;
 }
 eye.y=seated?seated.top+.95:newFeet+EYE_HEIGHT;
 if(eye.y<-2.1){eye.x=0;eye.z=14;eye.y=EYE_HEIGHT;eye.vy=0;eye.ground=true;toast('Returned to spawn · Peaceful mode')}}
 updateChunks();const dir=rayForward(),moving=playing&&(keys.KeyW||keys.KeyA||keys.KeyS||keys.KeyD||Math.abs(controls.forward)+Math.abs(controls.strafe)>.07),camY=eye.y;const hand=$('handOverlay');if(hand){const uiOpen=!!document.querySelector('.panel:not(.hidden)')||!$('spawnPopup').classList.contains('hidden');hand.style.opacity=playing&&!uiOpen?'1':'0';hand.style.transform='none';}const vp=mul(persp(Math.PI*.40,canvas.width/canvas.height,.1,108),lookAt(eye.x,camY,eye.z,eye.x+dir.x,camY+dir.y,eye.z+dir.z));viewProj=vp;
 gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);gl.uniformMatrix4fv(uni.vp,false,vp);gl.uniform3f(uni.eye,eye.x,eye.y,eye.z);gl.uniform3f(uni.sky,.55,.75,1);
 gl.bindTexture(gl.TEXTURE_2D,atlas);for(const m of chunks.values())drawMesh(m);drawMesh(spawnMesh);drawMesh(quarryMesh);
 for(const p of remotes.values()){let t=Math.min(1,dt*9);p.x+=(p.targetX-p.x)*t;p.y+=(p.targetY-p.y)*t;p.z+=(p.targetZ-p.z)*t;const phase=p.moving?Math.floor(now/105)%8:0;gl.bindTexture(gl.TEXTURE_2D,skinTextures[p.skin%6]||atlas);drawMesh(getAvatarMesh(p.skin||0,phase),p.x,p.y-1.7,p.z,p.yaw||0)}
 gl.bindTexture(gl.TEXTURE_2D,atlas);if(playing)showPlayerTags(now,vp);
 if(net.connected&&now-lastNetSend>190){lastNetSend=now;send({t:'move',x:eye.x,y:eye.y,z:eye.z,yaw:eye.yaw,moving:!!(keys.KeyW||keys.KeyS||controls.joystick)})}
 frameCount++;if(now-fpsStart>1500){frameFps=Math.round(frameCount*1000/(now-fpsStart));$('fps').textContent=frameFps+' FPS';frameCount=0;fpsStart=now;if(playing&&frameFps<23&&quality>.7&&now-lastQualityChange>7000){quality=.70;resize();lastQualityChange=now;toast('Automatic FPS mode enabled')}}
 if(playing&&frameCount%20===0){$('craftPrompt').hidden=!isNearCraft()||!!document.querySelector('.panel:not(.hidden)')||!$('spawnPopup').classList.contains('hidden');if(isNearCraft())setContext('Tap table · R or USE to craft');else if(Math.hypot(eye.x-24,eye.z-15)<5)setContext('Press USE near the Block Market portal');else if(Math.hypot(eye.x-quarry.x,eye.z-quarry.z)<9)setContext('Peaceful quarry: collect resources outside the spawn');else setContext(protectedZone(eye.x,eye.z)?'Safe 100x100 spawn · E inventory · T chat · 1-9 hotbar':'Wild zone · mine grass and dirt (2 layers)')}
}
// Read-only diagnostics for testing collision and entry points.
window.BLOCKFUN_DIAGNOSTICS={getPosition:()=>({x:eye.x,y:eye.y,z:eye.z}),blocked:(x,z,feet=eye.y-EYE_HEIGHT)=>intersectBody(x,feet,z),colliderCount:()=>solidBoxes.length};
requestAnimationFrame(tick);

} catch (e) {console.error("BLOCKFUN ENGINE ERROR",e); window.dispatchEvent(new CustomEvent("blockfun-error",{detail:"Error del motor: "+(e&&e.message?e.message:String(e))}));}
