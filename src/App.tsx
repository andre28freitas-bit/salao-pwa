import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isConfigured, supabase } from './lib/supabase'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { createWorker } from 'tesseract.js'

type Role = 'owner' | 'manager' | 'employee'
type View = 'today' | 'agenda' | 'clients' | 'alerts' | 'stock' | 'more'
type Member = { id:string; salon_id:string; user_id:string|null; display_name:string; role:Role; active:boolean }
type Service = { id:string; salon_id:string; name:string; duration_minutes:number; price:number; recurrence_weeks:number|null; active:boolean }
type Client = { id:string; salon_id:string; name:string; phone:string|null; email:string|null; notes:string|null; preferred_service_id:string|null; recurrence_weeks:number|null }
type Appointment = { id:string; salon_id:string; client_id:string; service_id:string|null; employee_id:string; starts_at:string; ends_at:string; status:'pending'|'confirmed'|'completed'|'cancelled'|'no_show'; notes:string|null }
type Visit = { id:string; salon_id:string; client_id:string; appointment_id:string|null; employee_id:string; service_id:string|null; occurred_on:string; service_label:string|null; color_formula:string|null; treatment_products:string|null; notes:string|null; amount_paid:number }
type Product = { id:string; salon_id:string; name:string; brand:string|null; barcode:string|null; unit:string; current_stock:number; min_stock:number; active:boolean }
type Salon = { id:string; name:string; timezone:string }

type Modal =
  | { kind:'appointment'; item?:Appointment; presetClient?:string }
  | { kind:'client'; item?:Client; prefill?:{name?:string; phone?:string} }
  | { kind:'clientDetail'; client:Client }
  | { kind:'visit'; appointment?:Appointment; client:Client }
  | { kind:'product'; item?:Product; barcode?:string }
  | { kind:'scanner' }
  | { kind:'invite' }
  | null

const locale = 'pt-PT'
const money = (value:number|string|null|undefined) => new Intl.NumberFormat(locale,{style:'currency',currency:'EUR'}).format(Number(value||0))
const todayISO = () => localISODate(new Date())
function localISODate(d:Date){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function dateLabel(iso:string){ return new Intl.DateTimeFormat(locale,{weekday:'long',day:'2-digit',month:'short'}).format(new Date(`${iso}T12:00:00`)) }
function addDays(iso:string,n:number){ const d=new Date(`${iso}T12:00:00`); d.setDate(d.getDate()+n); return localISODate(d) }
function hhmm(iso:string){ return new Intl.DateTimeFormat(locale,{hour:'2-digit',minute:'2-digit'}).format(new Date(iso)) }
function firstName(name:string){ return name.trim().split(/\s+/)[0] || name }
function weeksBetween(date:string){ return Math.floor((Date.now()-new Date(`${date}T12:00:00`).getTime())/(7*864e5)) }
function phoneDigits(phone:string|null){ return (phone||'').replace(/\D/g,'') }
function whatsApp(phone:string|null,text:string){ const p=phoneDigits(phone); if(!p) return alert('Esta cliente não tem número de telemóvel.'); window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`,'_blank') }

function downloadICS(a:Appointment, c?:Client, s?:Service, employee?:Member){
  const stamp=(iso:string)=>new Date(iso).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')
  const uid=`${a.id}@salao-pwa`
  const body=[
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Salao PWA//PT','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
    `UID:${uid}`,`DTSTAMP:${stamp(new Date().toISOString())}`,`DTSTART:${stamp(a.starts_at)}`,`DTEND:${stamp(a.ends_at)}`,
    `SUMMARY:${escapeICS(`${s?.name||'Marcação'} — ${c?.name||'Cliente'}`)}`,
    `DESCRIPTION:${escapeICS(`Salão · ${employee?.display_name||''}${a.notes?` · ${a.notes}`:''}`)}`,
    'END:VEVENT','END:VCALENDAR'
  ].join('\r\n')
  const blob=new Blob([body],{type:'text/calendar;charset=utf-8'})
  const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download=`marcacao-${localISODate(new Date(a.starts_at))}.ics`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000)
}
function escapeICS(s:string){ return s.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;') }

export default function App(){
  const [session,setSession]=useState<Session|null>(null)
  const [loading,setLoading]=useState(true)
  const [membership,setMembership]=useState<Member|null>(null)
  const [salon,setSalon]=useState<Salon|null>(null)
  const [members,setMembers]=useState<Member[]>([])
  const [services,setServices]=useState<Service[]>([])
  const [clients,setClients]=useState<Client[]>([])
  const [appointments,setAppointments]=useState<Appointment[]>([])
  const [visits,setVisits]=useState<Visit[]>([])
  const [products,setProducts]=useState<Product[]>([])
  const [view,setView]=useState<View>('today')
  const [agendaDate,setAgendaDate]=useState(todayISO())
  const [agendaMode,setAgendaMode]=useState<'mine'|'team'>('mine')
  const [modal,setModal]=useState<Modal>(null)
  const [clientQuery,setClientQuery]=useState('')
  const [stockQuery,setStockQuery]=useState('')
  const [toast,setToast]=useState('')
  const [passwordRecovery,setPasswordRecovery]=useState(false)

  const manager = membership?.role==='owner' || membership?.role==='manager'

  useEffect(()=>{
    if(!isConfigured){ setLoading(false); return }
    const resetFromUrl=new URLSearchParams(window.location.search).get('reset')==='1'
    if(resetFromUrl) setPasswordRecovery(true)
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)})
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,next)=>{
      setSession(next)
      if(event==='PASSWORD_RECOVERY') setPasswordRecovery(true)
    })
    return ()=>subscription.unsubscribe()
  },[])

  useEffect(()=>{ if(session?.user) loadMembership(); else {setMembership(null);setSalon(null)} },[session?.user?.id])
  useEffect(()=>{ if(!membership) return; loadData(); return subscribeRealtime() },[membership?.id])

  async function loadMembership(){
    setLoading(true)
    const {data,error}=await supabase.from('salon_members').select('*').eq('user_id',session!.user.id).eq('active',true).limit(1).maybeSingle()
    if(error) showToast(error.message)
    setMembership((data as Member)||null)
    if(data){
      const {data:s}=await supabase.from('salons').select('id,name,timezone').eq('id',data.salon_id).single()
      setSalon(s as Salon)
    }
    setLoading(false)
  }

  async function loadData(){
    if(!membership) return
    const salonId=membership.salon_id
    const [m,s,c,a,v,p]=await Promise.all([
      supabase.from('salon_members').select('*').eq('salon_id',salonId).eq('active',true).order('display_name'),
      supabase.from('services').select('*').eq('salon_id',salonId).eq('active',true).order('name'),
      supabase.from('clients').select('*').eq('salon_id',salonId).order('name'),
      supabase.from('appointments').select('*').eq('salon_id',salonId).order('starts_at'),
      supabase.from('visits').select('*').eq('salon_id',salonId).order('occurred_on',{ascending:false}),
      supabase.from('products').select('*').eq('salon_id',salonId).eq('active',true).order('name')
    ])
    for(const result of [m,s,c,a,v,p]) if(result.error) showToast(result.error.message)
    setMembers((m.data||[]) as Member[]); setServices((s.data||[]) as Service[]); setClients((c.data||[]) as Client[])
    setAppointments((a.data||[]) as Appointment[]); setVisits((v.data||[]) as Visit[]); setProducts((p.data||[]) as Product[])
  }

  function subscribeRealtime(){
    if(!membership) return ()=>{}
    const channel=supabase.channel(`salon-${membership.salon_id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'appointments',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'clients',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'visits',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'products',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .subscribe()
    return ()=>{supabase.removeChannel(channel)}
  }

  function showToast(message:string){ setToast(message); window.setTimeout(()=>setToast(''),2600) }
  const clientBy=(id:string)=>clients.find(x=>x.id===id)
  const serviceBy=(id:string|null)=>services.find(x=>x.id===id)
  const memberBy=(id:string)=>members.find(x=>x.id===id)

  const visibleAgenda = useMemo(()=>appointments.filter(a=>{
    const sameDay=localISODate(new Date(a.starts_at))===agendaDate
    const byPerson=!manager || agendaMode==='mine' ? a.employee_id===membership?.id : true
    return sameDay && byPerson && a.status!=='cancelled'
  }).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)),[appointments,agendaDate,agendaMode,manager,membership?.id])

  const todayAppointments=useMemo(()=>appointments.filter(a=>localISODate(new Date(a.starts_at))===todayISO() && a.status!=='cancelled').sort((a,b)=>a.starts_at.localeCompare(b.starts_at)),[appointments])

  const retention=useMemo(()=>clients.map(c=>{
    const history=visits.filter(v=>v.client_id===c.id).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on))
    const last=history[0]; if(!last) return null
    const due=Number(c.recurrence_weeks || serviceBy(c.preferred_service_id)?.recurrence_weeks || 0)
    if(!due) return null
    const passed=weeksBetween(last.occurred_on); const late=passed-due
    return {client:c,last,due,passed,late}
  }).filter(Boolean).filter((x:any)=>x.late>=0).sort((a:any,b:any)=>b.late-a.late) as {client:Client;last:Visit;due:number;passed:number;late:number}[],[clients,visits,services])

  const lowStock=products.filter(p=>Number(p.current_stock)<=Number(p.min_stock))

  if(loading) return <div className="splash"><div className="brandMark">S</div><p>A carregar…</p></div>
  if(!isConfigured) return <SetupScreen />
  if(session && (passwordRecovery || session.user.user_metadata?.needs_password===true)) return <PasswordResetScreen inviteSetup={session.user.user_metadata?.needs_password===true} onDone={()=>{ setPasswordRecovery(false); const u=new URL(window.location.href); u.searchParams.delete('reset'); window.history.replaceState({},'',u.pathname+u.search+u.hash) }} onToast={showToast} />
  if(!session) return <AuthScreen onToast={showToast} />
  if(!membership) return <Onboarding onDone={loadMembership} onToast={showToast} />

  return <div className="appShell">
    <header className="topbar">
      <div><div className="eyebrow">{salon?.name||'SALÃO'}</div><h1>{titleFor(view)}</h1></div>
      <button className="avatar" onClick={()=>setView('more')}>{initials(membership.display_name)}</button>
    </header>

    <main className="content">
      {view==='today' && <TodayView appointments={todayAppointments} retention={retention} lowStock={lowStock} clientBy={clientBy} serviceBy={serviceBy} memberBy={memberBy} onNew={()=>setModal({kind:'appointment'})} onClient={c=>setModal({kind:'clientDetail',client:c})} onBook={c=>setModal({kind:'appointment',presetClient:c.id})} />}
      {view==='agenda' && <AgendaView date={agendaDate} setDate={setAgendaDate} items={visibleAgenda} manager={manager} mode={agendaMode} setMode={setAgendaMode} membership={membership} clientBy={clientBy} serviceBy={serviceBy} memberBy={memberBy} onNew={()=>setModal({kind:'appointment'})} onOpen={a=>setModal({kind:'appointment',item:a})} onICS={a=>downloadICS(a,clientBy(a.client_id),serviceBy(a.service_id),memberBy(a.employee_id))} />}
      {view==='clients' && <ClientsView clients={clients} visits={visits} query={clientQuery} setQuery={setClientQuery} onNew={()=>startClientCreate(setModal,showToast)} onOpen={c=>setModal({kind:'clientDetail',client:c})} />}
      {view==='alerts' && <AlertsView retention={retention} lowStock={lowStock} onBook={c=>setModal({kind:'appointment',presetClient:c.id})} />}
      {view==='stock' && <StockView products={products} query={stockQuery} setQuery={setStockQuery} onScan={()=>setModal({kind:'scanner'})} onNew={()=>setModal({kind:'product'})} onEdit={p=>setModal({kind:'product',item:p})} onChange={changeStock} />}
      {view==='more' && <MoreView membership={membership} salon={salon} manager={manager} onInvite={()=>setModal({kind:'invite'})} onLogout={()=>supabase.auth.signOut()} />}
    </main>

    <nav className="bottomNav">
      {(['today','agenda','clients','alerts','stock'] as View[]).map(v=><button key={v} className={view===v?'active':''} onClick={()=>setView(v)}><span>{navIcon(v)}</span><small>{navLabel(v)}</small></button>)}
    </nav>

    {modal && <ModalLayer modal={modal} close={()=>setModal(null)} membership={membership} members={members} services={services} clients={clients} visits={visits} products={products} clientBy={clientBy} serviceBy={serviceBy} memberBy={memberBy} manager={manager} onSaved={async(message)=>{setModal(null);showToast(message);await loadData()}} onOpen={(m)=>setModal(m)} />}
    {toast && <div className="toast">{toast}</div>}
  </div>

  async function changeStock(product:Product,delta:number){
    const {error}=await supabase.rpc('record_stock_movement',{p_product:product.id,p_delta:delta,p_reason:'manual',p_notes:null})
    if(error) showToast(error.message); else {showToast('Stock atualizado.'); await loadData()}
  }
}

function SetupScreen(){
  return <div className="centerPage"><div className="brandMark">S</div><h1>Ligar ao Supabase</h1><p className="muted">A aplicação está pronta. Falta configurar as duas variáveis do projeto.</p><div className="codeCard"><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></div><p className="muted small">Usa a publishable key. Nunca coloques uma secret/service-role key no frontend.</p></div>
}

function AuthScreen({onToast}:{onToast:(m:string)=>void}){
  const [mode,setMode]=useState<'login'|'signup'|'forgot'>('login'); const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setBusy(true); const fd=new FormData(e.currentTarget); const email=String(fd.get('email')||'').trim(); const password=String(fd.get('password')||''); const name=String(fd.get('name')||'')
    if(mode==='forgot'){
      const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin})
      setBusy(false); if(error) onToast(error.message); else onToast('Email enviado. Abre o link para definires uma nova password.'); return
    }
    const result=mode==='login' ? await supabase.auth.signInWithPassword({email,password}) : await supabase.auth.signUp({email,password,options:{data:{full_name:name}}})
    setBusy(false); if(result.error) onToast(result.error.message); else if(mode==='signup' && !result.data.session) onToast('Conta criada. Confirma o email e depois inicia sessão.')
  }
  return <div className="authPage"><div className="authCard"><div className="brandMark">S</div><div><div className="eyebrow">SALÃO</div><h1>{mode==='login'?'Entrar':mode==='signup'?'Criar conta':'Recuperar password'}</h1><p className="muted">{mode==='forgot'?'Indica o teu email e enviamos um link para criares uma nova password.':'Agenda, clientes e stock num só lugar.'}</p></div><form onSubmit={submit} className="formStack">{mode==='signup'&&<label>Nome<input name="name" required placeholder="O teu nome" /></label>}<label>Email<input name="email" type="email" required autoComplete="email" /></label>{mode!=='forgot'&&<label>Password<input name="password" type="password" minLength={6} required autoComplete={mode==='login'?'current-password':'new-password'} /></label>}<button className="primary full" disabled={busy}>{busy?'A processar…':mode==='login'?'Entrar':mode==='signup'?'Criar conta':'Enviar link de recuperação'}</button></form>{mode==='login'&&<button className="textButton" onClick={()=>setMode('forgot')}>Esqueci-me da password</button>}<button className="textButton" onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'Ainda não tenho conta':mode==='signup'?'Já tenho conta':'Voltar ao login'}</button></div></div>
}

function PasswordResetScreen({inviteSetup,onDone,onToast}:{inviteSetup:boolean;onDone:()=>void;onToast:(m:string)=>void}){
  const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); const fd=new FormData(e.currentTarget); const password=String(fd.get('password')||''); const confirm=String(fd.get('confirm')||'')
    if(password.length<6) return onToast('A password deve ter pelo menos 6 caracteres.')
    if(password!==confirm) return onToast('As passwords não coincidem.')
    setBusy(true)
    const {error}=await supabase.auth.updateUser({password,data:{needs_password:false}})
    if(!error) await supabase.auth.refreshSession()
    setBusy(false)
    if(error) return onToast(error.message)
    onToast(inviteSetup?'Conta ativada. Bem-vindo à equipa.':'Password alterada com sucesso.')
    onDone()
  }
  return <div className="authPage"><div className="authCard"><div className="brandMark">S</div><div><div className="eyebrow">SALÃO</div><h1>{inviteSetup?'Definir password':'Nova password'}</h1><p className="muted">{inviteSetup?'Cria a tua password para concluir o convite.':'Escolhe uma nova password para a tua conta.'}</p></div><form className="formStack" onSubmit={submit}><label>Nova password<input name="password" type="password" minLength={6} required autoComplete="new-password" /></label><label>Confirmar password<input name="confirm" type="password" minLength={6} required autoComplete="new-password" /></label><button className="primary full" disabled={busy}>{busy?'A guardar…':'Guardar password'}</button></form></div></div>
}

function Onboarding({onDone,onToast}:{onDone:()=>void;onToast:(m:string)=>void}){
  const [tab,setTab]=useState<'create'|'join'>('create'); const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const fd=new FormData(e.currentTarget); const val=String(fd.get('value')||''); const {error}=tab==='create'?await supabase.rpc('create_salon_for_current_user',{p_name:val}):await supabase.rpc('accept_team_invite',{p_code:val}); setBusy(false); if(error)onToast(error.message); else onDone()}
  return <div className="authPage"><div className="authCard"><div className="brandMark">S</div><h1>Primeira configuração</h1><div className="segmented"><button className={tab==='create'?'active':''} onClick={()=>setTab('create')}>Criar salão</button><button className={tab==='join'?'active':''} onClick={()=>setTab('join')}>Tenho convite</button></div><form onSubmit={submit} className="formStack"><label>{tab==='create'?'Nome do salão':'Código do convite'}<input name="value" required placeholder={tab==='create'?'Ex.: Studio Maria':'Ex.: A4F91C2D'} /></label><button className="primary full" disabled={busy}>{tab==='create'?'Criar e continuar':'Entrar no salão'}</button></form></div></div>
}

function TodayView({appointments,retention,lowStock,clientBy,serviceBy,memberBy,onNew,onClient,onBook}:{appointments:Appointment[];retention:any[];lowStock:Product[];clientBy:(id:string)=>Client|undefined;serviceBy:(id:string|null)=>Service|undefined;memberBy:(id:string)=>Member|undefined;onNew:()=>void;onClient:(c:Client)=>void;onBook:(c:Client)=>void}){
  return <><div className="dateStrip"><div><div className="muted cap">{dateLabel(todayISO()).split(',')[0]}</div><strong>{new Intl.DateTimeFormat(locale,{day:'2-digit',month:'long'}).format(new Date())}</strong></div><button className="primary small" onClick={onNew}>+ Marcação</button></div><div className="kpis"><Kpi label="Hoje" value={appointments.length} sub="marcações"/><Kpi label="A contactar" value={retention.length} sub="clientes"/><Kpi label="Stock" value={lowStock.length} sub="alertas"/></div><Section title="Próximas marcações">{appointments.length?appointments.slice(0,5).map(a=><AppointmentCard key={a.id} a={a} c={clientBy(a.client_id)} s={serviceBy(a.service_id)} m={memberBy(a.employee_id)} onClient={()=>clientBy(a.client_id)&&onClient(clientBy(a.client_id)!)} />):<Empty>Sem marcações para hoje.</Empty>}</Section><Section title="Clientes a recuperar">{retention.length?retention.slice(0,4).map((r:any)=><RetentionCard key={r.client.id} r={r} onBook={()=>onBook(r.client)}/>):<Empty>Nenhuma cliente em atraso.</Empty>}</Section></>
}

function AgendaView({date,setDate,items,manager,mode,setMode,membership,clientBy,serviceBy,memberBy,onNew,onOpen,onICS}:{date:string;setDate:(s:string)=>void;items:Appointment[];manager:boolean;mode:'mine'|'team';setMode:(m:'mine'|'team')=>void;membership:Member;clientBy:(id:string)=>Client|undefined;serviceBy:(id:string|null)=>Service|undefined;memberBy:(id:string)=>Member|undefined;onNew:()=>void;onOpen:(a:Appointment)=>void;onICS:(a:Appointment)=>void}){
  return <><div className="agendaToolbar"><button className="iconButton" onClick={()=>setDate(addDays(date,-1))}>‹</button><input className="dateInput" type="date" value={date} onChange={e=>setDate(e.target.value)} /><button className="iconButton" onClick={()=>setDate(addDays(date,1))}>›</button><button className="primary small" onClick={onNew}>+ Marcar</button></div>{manager&&<div className="segmented"><button className={mode==='mine'?'active':''} onClick={()=>setMode('mine')}>Minha agenda</button><button className={mode==='team'?'active':''} onClick={()=>setMode('team')}>Equipa</button></div>}<div className="dayTitle">{dateLabel(date)}{!manager&&<span className="tag">{membership.display_name}</span>}</div><div className="timeline">{items.length?items.map(a=>{const c=clientBy(a.client_id),s=serviceBy(a.service_id),m=memberBy(a.employee_id);return <div className="timeRow" key={a.id}><div className="time">{hhmm(a.starts_at)}</div><article className="bookingCard"><button className="bookingMain" onClick={()=>onOpen(a)}><strong>{c?.name||'Cliente'}</strong><span>{s?.name||'Serviço'} · {m?.display_name}</span>{a.notes&&<small>{a.notes}</small>}</button><button className="calendarBtn" onClick={()=>onICS(a)} title="Adicionar ao calendário">▣</button></article></div>}):<Empty>Sem marcações neste dia.</Empty>}</div></>
}

function ClientsView({clients,visits,query,setQuery,onNew,onOpen}:{clients:Client[];visits:Visit[];query:string;setQuery:(q:string)=>void;onNew:()=>void;onOpen:(c:Client)=>void}){
  const arr=clients.filter(c=>`${c.name} ${c.phone||''}`.toLowerCase().includes(query.toLowerCase()))
  return <><div className="searchRow"><input type="search" placeholder="Procurar cliente…" value={query} onChange={e=>setQuery(e.target.value)} /><button className="primary square" onClick={onNew}>+</button></div><div className="stack">{arr.map(c=>{const last=visits.filter(v=>v.client_id===c.id).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on))[0];return <button className="clientCard" key={c.id} onClick={()=>onOpen(c)}><div><strong>{c.name}</strong><span>{last?`Última visita: ${new Intl.DateTimeFormat(locale).format(new Date(`${last.occurred_on}T12:00:00`))} · ${last.service_label||'Serviço'}`:'Sem histórico'}</span></div><b>›</b></button>})}</div></>
}

function AlertsView({retention,lowStock,onBook}:{retention:any[];lowStock:Product[];onBook:(c:Client)=>void}){
  const [tab,setTab]=useState<'clients'|'stock'>('clients')
  return <><div className="segmented"><button className={tab==='clients'?'active':''} onClick={()=>setTab('clients')}>Clientes ({retention.length})</button><button className={tab==='stock'?'active':''} onClick={()=>setTab('stock')}>Stock ({lowStock.length})</button></div>{tab==='clients'?<div className="stack">{retention.length?retention.map((r:any)=><RetentionCard key={r.client.id} r={r} onBook={()=>onBook(r.client)}/>):<Empty>Sem alertas de clientes.</Empty>}</div>:<div className="stack">{lowStock.length?lowStock.map(p=><ProductCard key={p.id} p={p} />):<Empty>Stock dentro dos mínimos.</Empty>}</div>}</>
}

function StockView({products,query,setQuery,onScan,onNew,onEdit,onChange}:{products:Product[];query:string;setQuery:(q:string)=>void;onScan:()=>void;onNew:()=>void;onEdit:(p:Product)=>void;onChange:(p:Product,d:number)=>void}){
  const arr=products.filter(p=>`${p.name} ${p.brand||''} ${p.barcode||''}`.toLowerCase().includes(query.toLowerCase()))
  return <><div className="stockActions"><button className="primary" onClick={onScan}>▣ Scan código</button><button className="secondary" onClick={onNew}>+ Produto</button></div><div className="searchRow"><input type="search" placeholder="Produto, marca ou código…" value={query} onChange={e=>setQuery(e.target.value)} /></div><div className="stack">{arr.map(p=><ProductCard key={p.id} p={p} actions={<><button className="mini" onClick={()=>onChange(p,-1)}>−1</button><button className="mini" onClick={()=>onChange(p,1)}>+1</button><button className="mini" onClick={()=>onEdit(p)}>Editar</button></>} />)}</div></>
}

function MoreView({membership,salon,manager,onInvite,onLogout}:{membership:Member;salon:Salon|null;manager:boolean;onInvite:()=>void;onLogout:()=>void}){
  return <div className="stack"><div className="profileCard"><div className="bigAvatar">{initials(membership.display_name)}</div><div><strong>{membership.display_name}</strong><span>{roleLabel(membership.role)} · {salon?.name}</span></div></div>{manager&&<button className="menuCard" onClick={onInvite}><span>👥</span><div><strong>Convidar colaborador</strong><small>Envia um convite diretamente por email.</small></div><b>›</b></button>}<button className="menuCard" onClick={onLogout}><span>↪</span><div><strong>Terminar sessão</strong><small>Sair deste dispositivo.</small></div><b>›</b></button></div>
}

function ModalLayer({modal,close,membership,members,services,clients,visits,products,clientBy,serviceBy,memberBy,manager,onSaved,onOpen}:{modal:Exclude<Modal,null>;close:()=>void;membership:Member;members:Member[];services:Service[];clients:Client[];visits:Visit[];products:Product[];clientBy:(id:string)=>Client|undefined;serviceBy:(id:string|null)=>Service|undefined;memberBy:(id:string)=>Member|undefined;manager:boolean;onSaved:(m:string)=>void;onOpen:(m:Modal)=>void}){
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="modalCard"><div className="modalHead"><h2>{modalTitle(modal)}</h2><button className="iconButton" onClick={close}>×</button></div>{modal.kind==='appointment'&&<AppointmentForm item={modal.item} presetClient={modal.presetClient} membership={membership} members={members} services={services} clients={clients} manager={manager} onSaved={onSaved} onVisit={a=>onOpen({kind:'visit',appointment:a,client:clientBy(a.client_id)!})} onDelete={async a=>{const {error}=await supabase.from('appointments').update({status:'cancelled'}).eq('id',a.id); if(error)alert(error.message); else onSaved('Marcação cancelada.')}} />}{modal.kind==='client'&&<ClientForm item={modal.item} prefill={modal.prefill} membership={membership} services={services} onSaved={onSaved} />}{modal.kind==='clientDetail'&&<ClientDetail client={modal.client} visits={visits} services={services} memberBy={memberBy} onEdit={()=>onOpen({kind:'client',item:modal.client})} onBook={()=>onOpen({kind:'appointment',presetClient:modal.client.id})} onVisit={()=>onOpen({kind:'visit',client:modal.client})} />}{modal.kind==='visit'&&<VisitForm client={modal.client} appointment={modal.appointment} membership={membership} serviceBy={serviceBy} onSaved={onSaved} />}{modal.kind==='product'&&<ProductForm item={modal.item} barcode={modal.barcode} membership={membership} onSaved={onSaved} />}{modal.kind==='scanner'&&<Scanner onFound={code=>{const existing=products.find(p=>p.barcode===code); onOpen(existing?{kind:'product',item:existing}:{kind:'product',barcode:code})}} />}{modal.kind==='invite'&&<InviteForm onSaved={onSaved} />}</div></div>
}

function AppointmentForm({item,presetClient,membership,members,services,clients,manager,onSaved,onVisit,onDelete}:{item?:Appointment;presetClient?:string;membership:Member;members:Member[];services:Service[];clients:Client[];manager:boolean;onSaved:(m:string)=>void;onVisit:(a:Appointment)=>void;onDelete:(a:Appointment)=>void}){
  const initialService=services.find(s=>s.id===item?.service_id)||services[0]
  const [serviceId,setServiceId]=useState(item?.service_id||initialService?.id||'')
  const [date,setDate]=useState(item?localISODate(new Date(item.starts_at)):todayISO())
  const [time,setTime]=useState(item?`${String(new Date(item.starts_at).getHours()).padStart(2,'0')}:${String(new Date(item.starts_at).getMinutes()).padStart(2,'0')}`:'09:00')
  const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const fd=new FormData(e.currentTarget); const s=services.find(x=>x.id===serviceId); const start=new Date(`${date}T${time}:00`); const end=new Date(start.getTime()+Number(s?.duration_minutes||45)*60000); const payload={salon_id:membership.salon_id,client_id:String(fd.get('client_id')),service_id:serviceId||null,employee_id:manager?String(fd.get('employee_id')):membership.id,starts_at:start.toISOString(),ends_at:end.toISOString(),status:String(fd.get('status')||'pending'),notes:String(fd.get('notes')||'')||null}; const q=item?supabase.from('appointments').update(payload).eq('id',item.id):supabase.from('appointments').insert(payload); const {error}=await q; setBusy(false); if(error)alert(error.message); else onSaved(item?'Marcação atualizada.':'Marcação criada.') }
  return <form className="formStack" onSubmit={submit}><label>Cliente<select name="client_id" defaultValue={item?.client_id||presetClient||clients[0]?.id}>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><div className="grid2"><label>Data<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label><label>Hora<input type="time" value={time} onChange={e=>setTime(e.target.value)} required/></label></div><label>Serviço<select value={serviceId} onChange={e=>setServiceId(e.target.value)}>{services.map(s=><option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min</option>)}</select></label>{manager&&<label>Profissional<select name="employee_id" defaultValue={item?.employee_id||membership.id}>{members.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label>}<label>Estado<select name="status" defaultValue={item?.status||'pending'}><option value="pending">Pendente</option><option value="confirmed">Confirmada</option><option value="completed">Concluída</option><option value="no_show">Faltou</option></select></label><label>Observações<textarea name="notes" defaultValue={item?.notes||''}/></label><button className="primary full" disabled={busy}>{busy?'A guardar…':'Guardar marcação'}</button>{item&&<div className="modalBottomActions"><button type="button" className="secondary" onClick={()=>onVisit(item)}>Concluir + histórico</button><button type="button" className="dangerButton" onClick={()=>onDelete(item)}>Cancelar marcação</button></div>}</form>
}

function ClientForm({item,prefill,membership,services,onSaved}:{item?:Client;prefill?:{name?:string;phone?:string};membership:Member;services:Service[];onSaved:(m:string)=>void}){
  const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const fd=new FormData(e.currentTarget);const payload={salon_id:membership.salon_id,name:String(fd.get('name')),phone:String(fd.get('phone')||'')||null,email:String(fd.get('email')||'')||null,preferred_service_id:String(fd.get('preferred_service_id')||'')||null,recurrence_weeks:Number(fd.get('recurrence_weeks')||0)||null,notes:String(fd.get('notes')||'')||null};const q=item?supabase.from('clients').update(payload).eq('id',item.id):supabase.from('clients').insert(payload);const {error}=await q;setBusy(false);if(error)alert(error.message);else onSaved(item?'Cliente atualizado.':'Cliente criado.')}
  return <form className="formStack" onSubmit={submit}><label>Nome<input name="name" required defaultValue={item?.name||prefill?.name||''}/></label><label>Telemóvel<input name="phone" inputMode="tel" defaultValue={item?.phone||prefill?.phone||''}/></label><label>Email<input name="email" type="email" defaultValue={item?.email||''}/></label><label>Serviço habitual<select name="preferred_service_id" defaultValue={item?.preferred_service_id||services[0]?.id||''}><option value="">Sem preferência</option>{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Recorrência (semanas)<input name="recurrence_weeks" type="number" min="1" defaultValue={item?.recurrence_weeks||''} placeholder="Ex.: 5"/></label><label>Observações<textarea name="notes" defaultValue={item?.notes||''}/></label><button className="primary full" disabled={busy}>Guardar cliente</button></form>
}

function ClientDetail({client,visits,services,memberBy,onEdit,onBook,onVisit}:{client:Client;visits:Visit[];services:Service[];memberBy:(id:string)=>Member|undefined;onEdit:()=>void;onBook:()=>void;onVisit:()=>void}){
  const history=visits.filter(v=>v.client_id===client.id).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on))
  const last=history[0]; const service=services.find(s=>s.id===client.preferred_service_id); const due=client.recurrence_weeks||service?.recurrence_weeks; const passed=last?weeksBetween(last.occurred_on):null
  return <div><div className="clientHero"><div className="bigAvatar">{initials(client.name)}</div><div><h3>{client.name}</h3><span>{client.phone||'Sem telefone'}</span></div></div><div className="quickActions">{client.phone&&<button className="secondary" onClick={()=>whatsApp(client.phone,`Olá ${firstName(client.name)} 😊`)}>WhatsApp</button>}<button className="secondary" onClick={onBook}>+ Marcar</button><button className="secondary" onClick={onEdit}>Editar</button></div>{client.notes&&<InfoCard label="Observações">{client.notes}</InfoCard>}{last&&due&&<InfoCard label="Recorrência">{passed} semanas desde a última visita · habitual {due}</InfoCard>}<div className="sectionHead"><h3>Histórico</h3><button className="textButton" onClick={onVisit}>+ Visita</button></div>{history.length?history.map(v=><div className="historyItem" key={v.id}><div><strong>{new Intl.DateTimeFormat(locale).format(new Date(`${v.occurred_on}T12:00:00`))} · {v.service_label||'Serviço'}</strong>{v.color_formula&&<span><b>Cor/fórmula:</b> {v.color_formula}</span>}{v.treatment_products&&<span><b>Tratamento/produtos:</b> {v.treatment_products}</span>}{v.notes&&<span>{v.notes}</span>}<small>{memberBy(v.employee_id)?.display_name}</small></div><b>{money(v.amount_paid)}</b></div>):<Empty>Sem histórico ainda.</Empty>}</div>
}

function VisitForm({client,appointment,membership,serviceBy,onSaved}:{client:Client;appointment?:Appointment;membership:Member;serviceBy:(id:string|null)=>Service|undefined;onSaved:(m:string)=>void}){
  const service=appointment?serviceBy(appointment.service_id):undefined
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const payload={salon_id:membership.salon_id,client_id:client.id,appointment_id:appointment?.id||null,employee_id:appointment?.employee_id||membership.id,service_id:appointment?.service_id||null,occurred_on:String(fd.get('occurred_on')),service_label:String(fd.get('service_label')||'')||null,color_formula:String(fd.get('color_formula')||'')||null,treatment_products:String(fd.get('treatment_products')||'')||null,notes:String(fd.get('notes')||'')||null,amount_paid:Number(fd.get('amount_paid')||0)};const {error}=await supabase.from('visits').insert(payload);if(error)return alert(error.message);if(appointment)await supabase.from('appointments').update({status:'completed'}).eq('id',appointment.id);onSaved('Visita guardada no histórico.')}
  return <form className="formStack" onSubmit={submit}><label>Data<input name="occurred_on" type="date" defaultValue={appointment?localISODate(new Date(appointment.starts_at)):todayISO()} required/></label><label>Serviço<input name="service_label" defaultValue={service?.name||''} placeholder="Ex.: Coloração + corte"/></label><label>Cor / fórmula técnica<textarea name="color_formula" placeholder="Ex.: 6/0 30g + 6/7 20g · Oxidante 6% 50g"/></label><label>Tratamentos / produtos<input name="treatment_products" placeholder="Ex.: Máscara Repair"/></label><label>Observações<textarea name="notes"/></label><label>Valor pago (€)<input name="amount_paid" type="number" step="0.01" defaultValue={service?.price||''}/></label><button className="primary full">Guardar visita</button></form>
}

type BarcodeLookupResult = {
  found:boolean
  name?:string
  brand?:string
  quantity?:string
  imageUrl?:string
  source?:string
}

async function lookupProductByBarcode(rawCode:string):Promise<BarcodeLookupResult>{
  const code=rawCode.replace(/\D/g,'')
  if(!code) return {found:false}
  const sources=[
    {label:'Open Beauty Facts',base:'https://world.openbeautyfacts.org'},
    {label:'Open Products Facts',base:'https://world.openproductsfacts.org'}
  ]
  for(const source of sources){
    try{
      const fields='code,product_name,product_name_pt,brands,quantity,image_front_url,categories'
      const r=await fetch(`${source.base}/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`,{headers:{Accept:'application/json'}})
      if(!r.ok) continue
      const data=await r.json()
      if(Number(data?.status)!==1 || !data?.product) continue
      const product=data.product
      const name=String(product.product_name_pt||product.product_name||'').trim()
      const brand=String(product.brands||'').split(',')[0].trim()
      if(!name && !brand) continue
      return {
        found:true,
        name:name||undefined,
        brand:brand||undefined,
        quantity:String(product.quantity||'').trim()||undefined,
        imageUrl:String(product.image_front_url||'').trim()||undefined,
        source:source.label
      }
    }catch(err){
      console.warn(`Barcode lookup failed at ${source.label}`,err)
    }
  }
  return {found:false}
}

function ProductForm({item,barcode,membership,onSaved}:{item?:Product;barcode?:string;membership:Member;onSaved:(m:string)=>void}){
  const [name,setName]=useState(item?.name||'')
  const [brand,setBrand]=useState(item?.brand||'')
  const [code,setCode]=useState(item?.barcode||barcode||'')
  const [scanOpen,setScanOpen]=useState(false)
  const [lookupBusy,setLookupBusy]=useState(false)
  const [lookup,setLookup]=useState<BarcodeLookupResult|null>(null)

  async function enrich(nextCode:string,quiet=false){
    const clean=nextCode.replace(/\D/g,'')
    setCode(clean)
    if(!clean) return
    setLookupBusy(true)
    const result=await lookupProductByBarcode(clean)
    setLookupBusy(false)
    setLookup(result)
    if(result.found){
      if(result.name) setName(result.name)
      if(result.brand) setBrand(result.brand)
    }else if(!quiet){
      alert('Código lido, mas não encontrei o produto nas bases públicas. Podes preencher o nome e a marca manualmente e guardar o código para futuras leituras.')
    }
  }

  useEffect(()=>{
    if(barcode && !item) void enrich(barcode,true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[barcode,item?.id])

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    const fd=new FormData(e.currentTarget)
    const payload={
      salon_id:membership.salon_id,
      name:name.trim(),
      brand:brand.trim()||null,
      barcode:code.trim()||null,
      unit:String(fd.get('unit')||'un.'),
      current_stock:item?item.current_stock:Number(fd.get('current_stock')||0),
      min_stock:Number(fd.get('min_stock')||0),
      active:true
    }
    if(!payload.name) return alert('Indica o nome do produto.')
    const q=item?supabase.from('products').update(payload).eq('id',item.id):supabase.from('products').insert(payload)
    const {error}=await q
    if(error)alert(error.message);else onSaved(item?'Produto atualizado.':'Produto criado.')
  }

  async function adjust(delta:number){
    if(!item)return
    const {error}=await supabase.rpc('record_stock_movement',{p_product:item.id,p_delta:delta,p_reason:'scanner',p_notes:null})
    if(error)alert(error.message);else onSaved(`Stock ${delta>0?'aumentado':'reduzido'} em 1.`)
  }

  if(scanOpen){
    return <div>
      <Scanner onFound={async scanned=>{setScanOpen(false);await enrich(scanned)}} />
      <button type="button" className="secondary full" onClick={()=>setScanOpen(false)}>Cancelar leitura</button>
    </div>
  }

  return <form className="formStack" onSubmit={submit}>
    <label>Produto<input name="name" required value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Koleston 6/0"/></label>
    <label>Marca<input name="brand" value={brand} onChange={e=>setBrand(e.target.value)}/></label>
    <label>Código de barras
      <div className="searchRow">
        <input name="barcode" inputMode="numeric" value={code} onChange={e=>{setCode(e.target.value.replace(/\D/g,''));setLookup(null)}} placeholder="EAN / UPC"/>
        <button type="button" className="secondary" onClick={()=>setScanOpen(true)}>📷 Scan</button>
      </div>
    </label>
    {code&&<div className="quickActions">
      <button type="button" className="secondary" disabled={lookupBusy} onClick={()=>void enrich(code)}>{lookupBusy?'A pesquisar…':'🔎 Procurar produto'}</button>
    </div>}
    {lookup?.found&&<div className="infoCard">
      <b>Produto encontrado · {lookup.source}</b>
      <span>{lookup.name||name}{lookup.brand?` · ${lookup.brand}`:''}{lookup.quantity?` · ${lookup.quantity}`:''}</span>
      {lookup.imageUrl&&<img src={lookup.imageUrl} alt="Produto encontrado" style={{width:72,height:72,objectFit:'contain',borderRadius:12,marginTop:8,background:'#fff'}}/>}
    </div>}
    {lookup && !lookup.found && <p className="muted">Não encontrado nas bases públicas. O código fica guardado na mesma.</p>}
    <div className="grid2"><label>Stock atual<input name="current_stock" type="number" step="0.1" defaultValue={item?.current_stock||0} readOnly={Boolean(item)}/></label><label>Stock mínimo<input name="min_stock" type="number" step="0.1" defaultValue={item?.min_stock||1}/></label></div>
    {item&&<div className="quickActions"><button type="button" className="secondary" onClick={()=>adjust(-1)}>−1 stock</button><button type="button" className="secondary" onClick={()=>adjust(1)}>+1 stock</button></div>}
    <label>Unidade<input name="unit" defaultValue={item?.unit||'un.'}/></label>
    <button className="primary full">Guardar produto</button>
  </form>
}

function validGTIN(code:string){
  if(![8,12,13,14].includes(code.length) || !/^\d+$/.test(code)) return false
  const digits=code.split('').map(Number)
  const check=digits.pop()!
  let sum=0
  for(let i=digits.length-1,mult=3;i>=0;i--,mult=mult===3?1:3) sum+=digits[i]*mult
  return ((10-(sum%10))%10)===check
}

function extractBarcodeFromText(text:string){
  const cleaned=text
    .replace(/[Oo]/g,'0')
    .replace(/[Il|]/g,'1')
    .replace(/[Ss]/g,'5')
    .replace(/[Bb]/g,'8')
  const found:string[]=[]
  const loose=cleaned.match(/(?:\d[\s.\-]*){8,14}/g)||[]
  for(const part of loose){
    const digits=part.replace(/\D/g,'')
    if([8,12,13,14].includes(digits.length)) found.push(digits)
  }
  const compact=cleaned.replace(/\D/g,'')
  for(const len of [13,12,8,14]){
    for(let i=0;i<=compact.length-len;i++) found.push(compact.slice(i,i+len))
  }
  const unique=[...new Set(found)]
  return unique.find(validGTIN)||unique.find(x=>[13,12,8,14].includes(x.length))||null
}

async function canvasFromImageFile(file:File){
  const url=URL.createObjectURL(file)
  try{
    const img=new Image()
    img.src=url
    await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('Não foi possível abrir a imagem.'))})
    const canvas=document.createElement('canvas')
    canvas.width=img.naturalWidth||img.width
    canvas.height=img.naturalHeight||img.height
    canvas.getContext('2d')!.drawImage(img,0,0)
    return canvas
  }finally{URL.revokeObjectURL(url)}
}

function captureVideoFrame(video:HTMLVideoElement){
  if(!video.videoWidth||!video.videoHeight) throw new Error('A câmara ainda não está pronta.')
  const canvas=document.createElement('canvas')
  canvas.width=video.videoWidth
  canvas.height=video.videoHeight
  canvas.getContext('2d')!.drawImage(video,0,0)
  return canvas
}

function cropBarcodeArea(source:HTMLCanvasElement){
  // A moldura ocupa aproximadamente a zona central mostrada no scanner.
  const sx=Math.round(source.width*.06)
  const sy=Math.round(source.height*.22)
  const sw=Math.round(source.width*.88)
  const sh=Math.round(source.height*.56)
  const canvas=document.createElement('canvas')
  canvas.width=sw
  canvas.height=sh
  canvas.getContext('2d')!.drawImage(source,sx,sy,sw,sh,0,0,sw,sh)
  return canvas
}

function prepareNumberStrip(source:HTMLCanvasElement){
  // Os algarismos EAN/UPC ficam normalmente sob as barras. Damos ao OCR uma zona
  // horizontal curta, ampliada e de alto contraste em vez da fotografia inteira.
  const sx=0
  const sy=Math.round(source.height*.45)
  const sw=source.width
  const sh=Math.max(1,Math.round(source.height*.55))
  const scale=Math.max(2,Math.min(4,1600/sw))
  const canvas=document.createElement('canvas')
  canvas.width=Math.round(sw*scale)
  canvas.height=Math.round(sh*scale)
  const ctx=canvas.getContext('2d')!
  ctx.imageSmoothingEnabled=true
  ctx.drawImage(source,sx,sy,sw,sh,0,0,canvas.width,canvas.height)
  const image=ctx.getImageData(0,0,canvas.width,canvas.height)
  const data=image.data
  for(let i=0;i<data.length;i+=4){
    const grey=.299*data[i]+.587*data[i+1]+.114*data[i+2]
    const v=grey>155?255:0
    data[i]=data[i+1]=data[i+2]=v
  }
  ctx.putImageData(image,0,0)
  return canvas
}

function Scanner({onFound}:{onFound:(code:string)=>void}){
  const videoRef=useRef<HTMLVideoElement>(null)
  const fileRef=useRef<HTMLInputElement>(null)
  const [status,setStatus]=useState('A iniciar a câmara traseira…')
  const [manual,setManual]=useState('')
  const [torch,setTorch]=useState(false)
  const [processing,setProcessing]=useState(false)
  const [ocrProgress,setOcrProgress]=useState<number|null>(null)
  const controlsRef=useRef<any>(null)
  const readerRef=useRef<BrowserMultiFormatReader|null>(null)
  const finishedRef=useRef(false)

  function finish(raw:string){
    if(finishedRef.current)return
    const code=String(raw||'').replace(/\D/g,'')
    if(!code)return
    finishedRef.current=true
    try{navigator.vibrate?.(80)}catch{}
    controlsRef.current?.stop?.()
    onFound(code)
  }

  useEffect(()=>{
    let alive=true
    let hintTimer:number|undefined
    ;(async()=>{
      try{
        if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable')
        const reader=new BrowserMultiFormatReader(undefined,{delayBetweenScanAttempts:80,delayBetweenScanSuccess:800,tryPlayVideoTimeout:7000})
        readerRef.current=reader
        setStatus('Mantém o código inteiro dentro da moldura. A leitura automática está ativa.')
        const controls=await reader.decodeFromConstraints(
          {video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false},
          videoRef.current||undefined,
          (result)=>{if(result&&alive)finish(result.getText())}
        )
        controlsRef.current=controls
        hintTimer=window.setTimeout(()=>{
          if(alive&&!finishedRef.current)setStatus('Se não ler automaticamente, centra o código e toca em “Ler agora”. Também consigo tentar ler os números por baixo das barras.')
        },2500)
      }catch(err){
        console.error(err)
        if(alive)setStatus('Não consegui fazer leitura contínua. Usa “Fotografar código” ou introduz os números manualmente.')
      }
    })()
    return()=>{
      alive=false
      if(hintTimer)window.clearTimeout(hintTimer)
      finishedRef.current=true
      controlsRef.current?.stop?.()
      controlsRef.current=null
      readerRef.current=null
    }
  },[])

  async function toggleTorch(){
    const controls=controlsRef.current
    if(!controls?.switchTorch) return alert('A lanterna não está disponível neste telemóvel/browser.')
    try{await controls.switchTorch(!torch);setTorch(v=>!v)}catch{alert('Não foi possível ligar a lanterna.')}
  }

  async function tryZXingCanvas(canvas:HTMLCanvasElement){
    const reader=readerRef.current||new BrowserMultiFormatReader(undefined,{delayBetweenScanAttempts:80})
    const url=canvas.toDataURL('image/jpeg',.94)
    try{
      const result=await reader.decodeFromImageUrl(url)
      return result.getText().replace(/\D/g,'')||null
    }catch{return null}
  }

  async function tryOCR(canvas:HTMLCanvasElement){
    setStatus('Não consegui ler as barras. A tentar reconhecer os números impressos por baixo…')
    setOcrProgress(0)
    const strip=prepareNumberStrip(canvas)
    const worker=await createWorker('eng',1,{logger:m=>{
      if(m.status==='recognizing text'&&typeof m.progress==='number') setOcrProgress(Math.round(m.progress*100))
    }})
    try{
      await worker.setParameters({
        tessedit_char_whitelist:'0123456789',
        preserve_interword_spaces:'1'
      })
      const {data}=await worker.recognize(strip)
      return extractBarcodeFromText(data.text||'')
    }finally{
      await worker.terminate()
      setOcrProgress(null)
    }
  }

  async function processCanvas(source:HTMLCanvasElement){
    if(processing||finishedRef.current)return
    setProcessing(true)
    try{
      const crop=cropBarcodeArea(source)
      setStatus('A tentar ler o código de barras…')
      const direct=await tryZXingCanvas(crop) || await tryZXingCanvas(source)
      if(direct){finish(direct);return}
      const fromText=await tryOCR(crop)
      if(fromText){finish(fromText);return}
      setStatus('Não consegui identificar o código. Aproxima mais, evita reflexos e garante que os números por baixo das barras ficam visíveis.')
    }catch(err){
      console.error(err)
      setStatus('Não consegui processar esta imagem. Tenta novamente com o código mais perto e bem focado.')
    }finally{setProcessing(false)}
  }

  async function captureNow(){
    try{
      if(!videoRef.current) return
      await processCanvas(captureVideoFrame(videoRef.current))
    }catch(err){console.error(err);setStatus('A câmara ainda não está pronta. Espera um segundo e tenta novamente.')}
  }

  async function scanPhoto(file?:File){
    if(!file)return
    setStatus('A analisar a fotografia…')
    try{await processCanvas(await canvasFromImageFile(file))}
    finally{if(fileRef.current)fileRef.current.value=''}
  }

  return <div>
    <div className="scannerWrap"><video ref={videoRef} playsInline muted autoPlay/><div className="scanFrame"><span style={{position:'absolute',left:8,right:8,bottom:8,color:'#fff',fontSize:12,textAlign:'center',textShadow:'0 1px 4px #000'}}>Barras + números dentro da moldura</span></div></div>
    <p className="muted">{status}{ocrProgress!==null?` (${ocrProgress}%)`:''}</p>
    <button type="button" className="primary full" disabled={processing} onClick={()=>void captureNow()}>{processing?'A analisar…':'🔎 Ler agora'}</button>
    <div className="quickActions">
      <button type="button" className="secondary" disabled={processing} onClick={toggleTorch}>🔦 {torch?'Desligar luz':'Ligar luz'}</button>
      <button type="button" className="secondary" disabled={processing} onClick={()=>fileRef.current?.click()}>📸 Fotografar código</button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={e=>void scanPhoto(e.target.files?.[0])}/>
    </div>
    <div className="searchRow"><input value={manual} onChange={e=>setManual(e.target.value.replace(/\D/g,''))} inputMode="numeric" placeholder="Ou escreve os números do código"/><button type="button" className="primary" disabled={!manual.trim()} onClick={()=>manual.trim()&&finish(manual.trim())}>Usar</button></div>
  </div>
}

function InviteForm({onSaved}:{onSaved:(m:string)=>void}){
  const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setBusy(true); const fd=new FormData(e.currentTarget); const email=String(fd.get('email')||'').trim(); const name=String(fd.get('name')||'').trim(); const role=String(fd.get('role')||'employee')
    const {data,error}=await supabase.functions.invoke('invite-member',{body:{email,name,role}})
    setBusy(false)
    if(error){alert(`Não foi possível enviar o convite: ${error.message}`);return}
    if(data?.error){alert(`Não foi possível enviar o convite: ${data.error}`);return}
    onSaved(`Convite enviado para ${email}.`)
  }
  return <form className="formStack" onSubmit={submit}><label>Email do colaborador<input name="email" type="email" required placeholder="nome@exemplo.pt" autoComplete="email"/></label><label>Nome do colaborador<input name="name" required placeholder="Ex.: Maria Silva"/></label><label>Permissão<select name="role" defaultValue="employee"><option value="employee">Colaborador — só vê a própria agenda</option><option value="manager">Gerente — vê toda a equipa</option></select></label><button className="primary full" disabled={busy}>{busy?'A enviar…':'Enviar convite por email'}</button><p className="muted small">O colaborador recebe um email, abre o convite e define a própria password.</p></form>
}

function startClientCreate(setModal:(m:Modal)=>void,showToast:(m:string)=>void){
  const contacts=(navigator as any).contacts
  if(contacts?.select){
    const useImport=window.confirm('Queres importar um contacto do telemóvel?\n\nOK = Importar contacto\nCancelar = Criar manualmente')
    if(useImport){ contacts.select(['name','tel'],{multiple:false}).then((rows:any[])=>{if(!rows?.length)return;const row=rows[0];setModal({kind:'client',prefill:{name:Array.isArray(row.name)?row.name[0]:row.name,phone:Array.isArray(row.tel)?row.tel[0]:row.tel}})}).catch(()=>showToast('Não foi possível importar o contacto.')); return }
  }
  setModal({kind:'client'})
}

function AppointmentCard({a,c,s,m,onClient}:{a:Appointment;c?:Client;s?:Service;m?:Member;onClient:()=>void}){return <article className="card"><div className="cardRow"><span className="timeTag">{hhmm(a.starts_at)}</span><div className="grow"><strong>{c?.name||'Cliente'}</strong><span>{s?.name||'Serviço'} · {m?.display_name||''}</span><div className="miniActions"><button className="mini" onClick={onClient}>Ficha</button>{c?.phone&&<button className="mini dark" onClick={()=>whatsApp(c.phone,`Olá ${firstName(c.name)} 😊 Só para confirmar a tua marcação às ${hhmm(a.starts_at)}. Mantém-se?`)}>WhatsApp</button>}</div></div></div></article>}
function RetentionCard({r,onBook}:{r:{client:Client;last:Visit;due:number;passed:number;late:number};onBook:()=>void}){const text=`Olá ${firstName(r.client.name)} 😊 Já passaram cerca de ${r.passed} semanas desde a tua última visita. Queres que te reserve um horário?`;return <article className="card"><strong>{r.client.name}</strong><span>Última visita: {new Intl.DateTimeFormat(locale).format(new Date(`${r.last.occurred_on}T12:00:00`))} · habitual {r.due} semanas</span><div className="tagRow"><span className={`tag ${r.late>=2?'danger':'warn'}`}>{r.late===0?'Está na altura':`${r.late} sem. em atraso`}</span></div><div className="miniActions"><button className="mini dark" onClick={()=>whatsApp(r.client.phone,text)}>WhatsApp</button><button className="mini" onClick={onBook}>Marcar</button></div></article>}
function ProductCard({p,actions}:{p:Product;actions?:ReactNode}){const low=Number(p.current_stock)<=Number(p.min_stock);return <article className="card"><strong>{p.name}</strong><span>{p.brand||''}{p.barcode?` · ${p.barcode}`:''}</span><div className="tagRow"><span className={`tag ${low?'danger':'ok'}`}>Stock: {p.current_stock} {p.unit}</span><span className="tag">Mín.: {p.min_stock}</span></div>{actions&&<div className="miniActions">{actions}</div>}</article>}
function Kpi({label,value,sub}:{label:string;value:number;sub:string}){return <article className="kpi"><span>{label}</span><strong>{value}</strong><small>{sub}</small></article>}
function Section({title,children}:{title:string;children:ReactNode}){return <section><div className="sectionHead"><h2>{title}</h2></div><div className="stack">{children}</div></section>}
function Empty({children}:{children:ReactNode}){return <div className="empty">{children}</div>}
function InfoCard({label,children}:{label:string;children:ReactNode}){return <div className="infoCard"><span>{label}</span><strong>{children}</strong></div>}

function modalTitle(m:Exclude<Modal,null>){return m.kind==='appointment'?(m.item?'Editar marcação':'Nova marcação'):m.kind==='client'?(m.item?'Editar cliente':'Novo cliente'):m.kind==='clientDetail'?m.client.name:m.kind==='visit'?'Registar visita':m.kind==='product'?(m.item?'Editar produto':'Novo produto'):m.kind==='scanner'?'Ler código de barras':'Convidar colaborador'}
function titleFor(v:View){return ({today:'Hoje',agenda:'Agenda',clients:'Clientes',alerts:'Alertas',stock:'Stock',more:'Conta'} as const)[v]}
function navLabel(v:View){return ({today:'Hoje',agenda:'Agenda',clients:'Clientes',alerts:'Alertas',stock:'Stock',more:'Mais'} as const)[v]}
function navIcon(v:View){return ({today:'⌂',agenda:'□',clients:'♙',alerts:'!',stock:'▤',more:'•••'} as const)[v]}
function initials(name:string){return name.split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()).join('')||'S'}
function roleLabel(role:Role){return role==='owner'?'Proprietário':role==='manager'?'Gerente':'Colaborador'}
