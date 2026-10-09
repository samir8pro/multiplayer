(()=>{
 'use strict';
 const $=id=>document.getElementById(id),play=$('play'),status=$('startStatus'),retry=$('retryMotor');
 let wantsToPlay=false, failed=false, booted=false, attemptStarted=performance.now();
 function show(msg,isError=false){status.textContent=msg;status.style.color=isError?'#ffb8a9':'';retry.style.display=isError?'block':'none';if(isError){play.textContent='↻ RETRY';}else if(!booted){play.textContent=wantsToPlay?'⏳ LOADING...':'▶ PLAY NOW';}}
 function ready(){if(failed)return;booted=true;show('✅ Engine ready');play.textContent='▶ PLAY NOW';if(wantsToPlay)launch();}
 function launch(){wantsToPlay=true;if(failed){reload();return}if(window.BLOCKFUN_READY&&typeof window.BLOCKFUN_START==='function'){
    try{window.BLOCKFUN_START();}catch(e){fail('Game start error: '+(e?.message||'unknown'))}
    return;
 } show('Loading 3D engine...');}
 function fail(message){if(booted)return;failed=true;show(message,true)}
 function reload(){let u=new URL(location.href);u.searchParams.set('retry',Date.now().toString(36));location.replace(u.href)}
 play.addEventListener('click',launch);
 retry.addEventListener('click',reload);
 $('nick').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();launch()}});
 window.addEventListener('blockfun-ready',ready);
 window.addEventListener('blockfun-error',e=>fail(String(e.detail||'WebGL unavailable')));
 window.addEventListener('error',e=>{
   if(booted)return;
   if(e.target?.tagName==='SCRIPT'&&e.target?.id==='blockfunEngine')fail('Could not download game.js. Check the Netlify deploy.');
   else if(e.message&&!String(e.message).includes('ResizeObserver'))fail('Engine error: '+String(e.message).slice(0,150));
 },true);
 window.addEventListener('unhandledrejection',e=>{if(!booted)fail('Startup failed: '+String(e.reason?.message||e.reason).slice(0,150))});
 setTimeout(()=>{if(!booted&&!failed)show('The engine is taking longer than expected. Check your connection...',false)},4500);
 setTimeout(()=>{if(!booted&&!failed)fail('The engine did not load. Press RETRY or open the game in Chrome.')},10000);
 if(window.BLOCKFUN_READY&&typeof window.BLOCKFUN_START==='function')ready();
})();
