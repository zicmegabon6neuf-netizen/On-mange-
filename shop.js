let products=[],cart={};const $=s=>document.querySelector(s),money=n=>new Intl.NumberFormat('fr-FR').format(n)+' FCFA',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let storeSettings={};
async function load(){let d=await fetch('/api/store').then(r=>r.json());products=d.products;storeSettings=d.settings||{};if(storeSettings.storeName)document.title=storeSettings.storeName;$('#products').innerHTML=products.map(p=>`<article class="product"><div class="pic">${p.image?`<img src="${esc(p.image)}" alt="">`:'🍲'}</div><div class="pbody"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><div class="pfoot"><b>${money(p.price)}</b><button onclick="add(${p.id})">+</button></div></div></article>`).join('');renderCart()}
function add(id){cart[id]=(cart[id]||0)+1;renderCart()}
function renderCart(){let rows=Object.entries(cart),sum=0,count=0;$('#cart').innerHTML=rows.map(([id,q])=>{let p=products.find(x=>x.id==id);if(!p)return'';sum+=p.price*q;count+=q;return `<div class="line">${esc(p.name)} × ${q} <button onclick="qty(${id},-1)">−</button> <button onclick="qty(${id},1)">+</button> <b>${money(p.price*q)}</b></div>`}).join('')||'Panier vide.';$('#total').textContent=money(sum+(Number(storeSettings.deliveryFee)||0));$('#count').textContent=count;const label=$('#cartItemsLabel');if(label)label.textContent=count+' article'+(count>1?'s':'')}
function qty(id,n){cart[id]=Math.max(0,(cart[id]||0)+n);if(!cart[id])delete cart[id];renderCart()}
$('#form').onsubmit=async e=>{e.preventDefault();let items=Object.entries(cart).map(([id,qty])=>({id:Number(id),qty}));if(!items.length){$('#message').textContent='Ajoute un plat.';return}let data=Object.fromEntries(new FormData(e.target));data.items=items;let r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),d=await r.json();if(!r.ok){$('#message').textContent=d.error;return}
let lines=d.order.items.map(x=>`${x.name} x${x.qty} : ${money(x.price*x.qty)}`).join('\\n'),txt=`Commande #${d.order.id}\\n${data.name}\\n${data.phone}\\n${data.address}\\n${lines}\\nTotal ${money(d.order.total)}\\nPaiement : ${data.payment}`;
let paymentNote='';
if(data.payment==='moov'){
 const num=String(d.moovNumber||'062098889').replace(/\\D/g,'');
 const ussd=`*555*2*${num}*${d.order.total}#`;
 paymentNote=`<p><b>Paiement Moov Money :</b> commande enregistrée. Vérifie le montant de <b>${money(d.order.total)}</b>, puis appuie sur le bouton ci-dessous. Le téléphone ouvrira l'écran USSD ; saisis ton code secret uniquement dans le menu officiel Moov Money et confirme toi-même l'opération.</p><button type="button" class="button" id="moovPay">Ouvrir Moov Money (*555*2*${esc(num)}*${d.order.total}#)</button><p class="hint">Le site ne demande, ne reçoit et ne stocke jamais ton code secret. Vérifie le nom du bénéficiaire et le montant affichés par Moov avant de confirmer.</p>`;
}
const wa=`<a target="_blank" rel="noopener" href="https://wa.me/${d.whatsapp.replace(/\\D/g,'')}?text=${encodeURIComponent(txt)}">Envoyer les détails sur WhatsApp</a>`;
$('#message').innerHTML=`Commande #${d.order.id} enregistrée. ${paymentNote} ${data.payment==='moov'?'':wa}`;
if(data.payment==='moov'){$('#moovPay').onclick=()=>{if(confirm(`Ouvrir le menu USSD Moov Money pour ${money(d.order.total)} ? Tu saisiras ton code secret directement dans le menu officiel.`)){window.location.href='tel:'+ussd.replace('#','%23')}}}
cart={};renderCart();e.target.reset()};
load();
