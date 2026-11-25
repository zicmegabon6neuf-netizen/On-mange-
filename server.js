const express=require("express");
const session=require("express-session");
const helmet=require("helmet");
const rateLimit=require("express-rate-limit");
const bcrypt=require("bcryptjs");
const Database=require("better-sqlite3");
const path=require("path");

const app=express(),db=new Database("on-mange-dabord.sqlite");
const PORT=process.env.PORT||3000,SECRET=process.env.SESSION_SECRET;
if(!SECRET||SECRET.length<32){console.error("SESSION_SECRET doit contenir au moins 32 caractères.");process.exit(1);}
db.exec(`
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,description TEXT DEFAULT '',price INTEGER NOT NULL,category TEXT DEFAULT 'Plats',image TEXT DEFAULT '',available INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_name TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,payment TEXT NOT NULL,total INTEGER NOT NULL,items_json TEXT NOT NULL,status TEXT DEFAULT 'Nouvelle',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
const defaults={storeName:"ON MANGE D'ABORD",whatsapp:"+24162098889",moovMerchant:"062098889",airtelMerchant:"",deliveryFee:"0"};
for(const [k,v] of Object.entries(defaults))db.prepare("INSERT OR IGNORE INTO settings VALUES(?,?)").run(k,v);
if(!db.prepare("SELECT COUNT(*) n FROM products").get().n){
 const add=db.prepare("INSERT INTO products(name,description,price,category) VALUES(?,?,?,?)");
 [["Poulet braisé","Poulet braisé et garniture",3000,"Plats"],["Poisson braisé","Poisson braisé et accompagnement",3500,"Plats"],["Riz sauce","Riz accompagné de sa sauce maison",1500,"Plats"],["Poulet mayo","Poulet et sauce mayonnaise maison",2500,"Plats"],["Jus naturel","Jus frais du jour",1000,"Boissons"]].forEach(x=>add.run(...x));
}
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"100kb"}));
app.use(session({name:"omd.sid",secret:SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:2*60*60*1000}}));
app.use(express.static(path.join(__dirname,"public")));
const limiter=rateLimit({windowMs:15*60*1000,max:8,standardHeaders:true,legacyHeaders:false});
const get=k=>db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value||"";
const put=(k,v)=>db.prepare("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k,String(v));
const auth=(req,res,next)=>req.session.admin?next():res.status(401).json({error:"Connexion administrateur requise."});

app.get("/api/store",(req,res)=>res.json({settings:{storeName:get("storeName"),deliveryFee:Number(get("deliveryFee"))||0},products:db.prepare("SELECT * FROM products WHERE available=1 ORDER BY category,name").all()}));
app.post("/api/orders",(req,res)=>{
 const {name,phone,address,payment,items}=req.body||{};
 if(!name||!phone||!address||!["delivery","moov","airtel"].includes(payment)||!Array.isArray(items)||!items.length)return res.status(400).json({error:"Commande incomplète."});
 const all=db.prepare("SELECT id,name,price FROM products WHERE available=1").all(),map=new Map(all.map(p=>[p.id,p]));let total=0,clean=[];
 for(const it of items){const p=map.get(Number(it.id)),qty=Math.max(1,Math.min(30,Number(it.qty)||1));if(!p)return res.status(400).json({error:"Produit indisponible."});total+=p.price*qty;clean.push({...p,qty});}
 total+=Number(get("deliveryFee"))||0;
 const info=db.prepare("INSERT INTO orders(customer_name,phone,address,payment,total,items_json) VALUES(?,?,?,?,?,?)").run(name,phone,address,payment,total,JSON.stringify(clean));
 res.json({ok:true,order:{id:Number(info.lastInsertRowid),name,phone,address,payment,total,items:clean},whatsapp:get("whatsapp"),moovNumber:get("moovMerchant"),airtelMerchant:get("airtelMerchant")});
});
app.get("/api/admin/state",(req,res)=>res.json({setup:db.prepare("SELECT COUNT(*) n FROM admins").get().n===0,authenticated:!!req.session.admin,username:req.session.admin||null}));
app.post("/api/admin/setup",limiter,async(req,res)=>{
 if(db.prepare("SELECT COUNT(*) n FROM admins").get().n)return res.status(403).json({error:"Le compte administrateur est déjà créé."});
 const {username,password,confirm}=req.body||{};
 if(!username||!password||password!==confirm||password.length<12)return res.status(400).json({error:"Identifiant requis. Mot de passe de 12 caractères minimum et confirmation identique."});
 const hash=await bcrypt.hash(password,12);db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)").run(username.trim(),hash);req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Erreur de session."});req.session.admin=username.trim();res.json({ok:true});});
});
app.post("/api/admin/login",limiter,async(req,res)=>{
 const {username,password}=req.body||{},a=db.prepare("SELECT * FROM admins WHERE username=?").get(username||"");
 if(!a||!(await bcrypt.compare(password||"",a.password_hash)))return res.status(401).json({error:"Identifiant ou mot de passe incorrect."});
 req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Erreur de session."});req.session.admin=a.username;res.json({ok:true});});
});
app.post("/api/admin/logout",auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/summary",auth,(req,res)=>{
 const orders=db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 500").all().map(o=>({...o,items:JSON.parse(o.items_json)}));
 const total=db.prepare("SELECT COUNT(*) n FROM orders").get().n, revenue=db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status!='Annulée'").get().n;
 res.json({orders,total,revenue,products:db.prepare("SELECT * FROM products ORDER BY id DESC").all()});
});
app.delete("/api/admin/orders",auth,(req,res)=>{
 db.prepare("DELETE FROM orders").run();
 // Réinitialise aussi le compteur pour garder un historique propre.
 try{db.prepare("DELETE FROM sqlite_sequence WHERE name='orders'").run();}catch{}
 res.json({ok:true});
});
app.patch("/api/admin/password",auth,async(req,res)=>{
 const {currentPassword,newPassword,confirmPassword}=req.body||{};
 const a=db.prepare("SELECT * FROM admins WHERE username=?").get(req.session.admin);
 if(!a||!(await bcrypt.compare(currentPassword||"",a.password_hash)))return res.status(401).json({error:"Mot de passe actuel incorrect."});
 if(!newPassword||newPassword.length<12||newPassword!==confirmPassword)return res.status(400).json({error:"Le nouveau mot de passe doit contenir au moins 12 caractères et les deux saisies doivent être identiques."});
 const hash=await bcrypt.hash(newPassword,12);
 db.prepare("UPDATE admins SET password_hash=? WHERE id=?").run(hash,a.id);
 res.json({ok:true});
});
app.patch("/api/admin/orders/:id",auth,(req,res)=>{
 const valid=["Nouvelle","Confirmée","En préparation","En livraison","Terminée","Annulée"];
 if(!valid.includes(req.body.status))return res.status(400).json({error:"Statut invalide."});
 db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status,req.params.id);res.json({ok:true});
});
app.post("/api/admin/products",auth,(req,res)=>{
 const p=req.body||{};if(!p.name||!Number.isInteger(Number(p.price))||Number(p.price)<0)return res.status(400).json({error:"Nom et prix valides requis."});
 const r=db.prepare("INSERT INTO products(name,description,price,category,image,available) VALUES(?,?,?,?,?,?)").run(p.name,p.description||"",Number(p.price),p.category||"Plats",p.image||"",p.available?1:0);res.json({ok:true,id:Number(r.lastInsertRowid)});
});
app.put("/api/admin/products/:id",auth,(req,res)=>{
 const p=req.body||{};if(!p.name||!Number.isInteger(Number(p.price))||Number(p.price)<0)return res.status(400).json({error:"Nom et prix valides requis."});
 db.prepare("UPDATE products SET name=?,description=?,price=?,category=?,image=?,available=? WHERE id=?").run(p.name,p.description||"",Number(p.price),p.category||"Plats",p.image||"",p.available?1:0,req.params.id);res.json({ok:true});
});
app.delete("/api/admin/products/:id",auth,(req,res)=>{db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);res.json({ok:true});});
app.get("/api/admin/settings",auth,(req,res)=>res.json(Object.fromEntries(Object.keys(defaults).map(k=>[k,get(k)]))));
app.put("/api/admin/settings",auth,(req,res)=>{for(const k of Object.keys(defaults))if(req.body[k]!==undefined)put(k,String(req.body[k]).slice(0,200));res.json({ok:true});});
app.listen(PORT,()=>console.log("ON MANGE D'ABORD sur le port "+PORT));
