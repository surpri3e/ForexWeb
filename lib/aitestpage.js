// صفحهٔ تست کلید هوش مصنوعی: /api/ai/test-page  (تست از روی خود سرور انجام می‌شه، نه از گوشی تو)
export const AI_TEST_PAGE = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تست کلید هوش مصنوعی</title>
<style>
:root{--bg:#F6F1E7;--card:#FFFDF8;--ln:#E6DFD0;--tx:#1F2A24;--dim:#7A7566;--ok:#1F7A4D;--bad:#C4473A;--warn:#B7791F}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.9 Vazirmatn,Tahoma,system-ui,sans-serif}
.w{max-width:720px;margin:0 auto;padding:20px 16px 60px}h1{font-size:21px;margin:6px 0 2px}p.s{color:var(--dim);margin:0 0 14px;font-size:13px}
.card{background:var(--card);border:1px solid var(--ln);border-radius:16px;padding:14px 16px;margin-bottom:12px}
label{display:block;font-size:13px;color:var(--dim);margin:8px 0 4px}
input{width:100%;border:1px solid var(--ln);background:#fff;border-radius:12px;padding:10px 12px;font:14px ui-monospace,Menlo,monospace;color:var(--tx);direction:ltr;text-align:left}
button{font:inherit;border:0;border-radius:999px;padding:10px 20px;cursor:pointer;background:var(--ok);color:#fff;font-weight:700;margin-top:12px}button:disabled{opacity:.5}
.dx{border-radius:12px;padding:10px 12px;margin:6px 0;font-size:14px;background:#EAE3D2}.dx.ok{background:#DDEFE4;color:var(--ok)}.dx.bad{background:#F6DEDA;color:var(--bad)}
table{width:100%;border-collapse:collapse;font-size:13px;direction:ltr}td,th{border-bottom:1px solid var(--ln);padding:6px 4px;text-align:left;vertical-align:top;word-break:break-word}
.sc{overflow-x:auto}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--dim);direction:ltr;text-align:left;word-break:break-all}
@media (prefers-color-scheme:dark){:root{--bg:#171A18;--card:#1F2421;--ln:#2D3430;--tx:#E8EDE9;--dim:#9AA39D}input{background:#171A18}.dx{background:#2D3430}.dx.ok{background:#1D3A2A;color:#7FD6A4}.dx.bad{background:#40231F;color:#F0A39A}}
</style></head><body><div class="w">
<h1>تست کلید هوش مصنوعی</h1>
<p class="s">تست از روی سرور سایت انجام می‌شه، یعنی دقیقاً همون چیزی که ربات می‌بینه. کلید جایی ذخیره نمی‌شه.</p>
<div class="card">
<label for="ak">رمز ادمین (ADMIN_KEY)</label><input id="ak" type="password" autocomplete="off">
<label for="k">کلید Groq (gsk_...) یا Gemini. خالی بذاری، کلید ذخیره‌شده روی سرور تست می‌شه</label><input id="k" type="password" autocomplete="off" placeholder="اختیاری">
<button id="go">تست کن</button></div>
<div id="out"></div></div>
<script>
const $=(i)=>document.getElementById(i);const esc=(s)=>String(s==null?'':s).replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
$('go').onclick=async()=>{const b=$('go');b.disabled=true;b.textContent='در حال تست...';$('out').innerHTML='';
 try{const r=await fetch('/api/ai/keytest',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Key':$('ak').value.trim()},body:JSON.stringify({key:$('k').value.trim()})});
  const j=await r.json().catch(()=>({}));
  if(r.status===401){$('out').innerHTML='<div class="dx bad">رمز ادمین درست نیست.</div>';}
  else if(r.status===429){$('out').innerHTML='<div class="dx bad">تعداد تلاش زیاد بود؛ چند دقیقه بعد دوباره امتحان کن.</div>';}
  else if(!r.ok){$('out').innerHTML='<div class="dx bad">خطای سرور ('+r.status+')</div>';}
  else{let h='<div class="card"><b>نتیجه</b>'+j.diagnosis.map((d)=>'<div class="dx '+(/درست کار می‌کنه/.test(d)?'ok':'bad')+'">'+esc(d)+'</div>').join('')+'<div class="mono">کلید: '+esc(j.source==='typed'?'واردشده':j.source==='saved'?'ذخیره‌شده روی سرور':'ندارد')+' · نوع: '+esc(j.kind||'-')+'</div></div>';
   if(j.list)h+='<div class="card"><b>فهرست مدل‌ها</b><div class="mono">وضعیت '+esc(j.list.status)+' · '+esc(j.list.count)+' مدل · '+esc(j.list.ms)+'ms'+(j.list.error?' · '+esc(j.list.error):'')+'</div>'+(j.list.msg?'<div class="dx bad">'+esc(j.list.msg)+'</div>':'')+'<div class="mono">'+esc((j.list.models||[]).join(' , '))+'</div></div>';
   if(j.tries.length)h+='<div class="card"><b>تست پیام</b><div class="sc"><table><tr><th>مدل</th><th>وضعیت</th><th>ms</th><th>پیام</th></tr>'+j.tries.map((t)=>'<tr><td>'+esc(t.model)+'</td><td>'+(t.ok?'OK':esc(t.status||t.error))+'</td><td>'+esc(t.ms)+'</td><td>'+esc(t.msg||'')+'</td></tr>').join('')+'</table></div></div>';
   $('out').innerHTML=h;}
 }catch(e){$('out').innerHTML='<div class="dx bad">اتصال به سرور نشد.</div>';}
 b.disabled=false;b.textContent='تست کن';};
</script></body></html>`;

// END-OF-FILE lib/aitestpage.js
