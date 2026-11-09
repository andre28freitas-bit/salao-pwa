import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isConfigured, supabase } from './lib/supabase'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { createWorker } from 'tesseract.js'
import LandingPage from './LandingPage'
import BarberDemo from './BarberDemo'
import BusinessHub, { type BusinessTab } from './BusinessTools'

type Role = 'owner' | 'manager' | 'employee'
type View = 'today' | 'agenda' | 'clients' | 'alerts' | 'stock' | 'more'
type Member = { id:string; salon_id:string; user_id:string|null; display_name:string; role:Role; active:boolean; calendar_color:string }
type Service = { id:string; salon_id:string; name:string; duration_minutes:number; price:number; recurrence_weeks:number|null; image_url:string|null; active:boolean }
type Client = { id:string; salon_id:string; name:string; phone:string|null; email:string|null; birth_date:string|null; notes:string|null; preferred_service_id:string|null; preferred_employee_id:string|null; recurrence_weeks:number|null; dormant_after_weeks:number|null }
type Appointment = { id:string; salon_id:string; client_id:string; service_id:string|null; employee_id:string; starts_at:string; ends_at:string; status:'pending'|'confirmed'|'completed'|'cancelled'|'no_show'; notes:string|null }
type Visit = { id:string; salon_id:string; client_id:string; appointment_id:string|null; employee_id:string; service_id:string|null; occurred_on:string; service_label:string|null; color_formula:string|null; treatment_products:string|null; notes:string|null; amount_paid:number }
type Product = { id:string; salon_id:string; name:string; brand:string|null; barcode:string|null; unit:string; current_stock:number; min_stock:number; active:boolean }
type BookingRequest = { id:string; salon_id:string; client_id:string|null; name:string; phone:string; service_name:string; preferred_date:string; preferred_period:'morning'|'afternoon'|'no_preference'; notes:string|null; status:'new'|'contacted'|'booked'|'closed'; created_at:string }
type Salon = { id:string; name:string; timezone:string }
type BusinessSettings = { salon_id:string; dormant_after_weeks:number }
type BrandSettings = { logo_url:string|null }
type DashboardWidget = 'summary'|'business'|'sales'|'goals'|'appointments'|'requests'|'tomorrow'|'recovery'|'birthdays'|'stock'
type SaleSummary = { id:string; occurred_at:string; total_amount:number }
type GoalSummary = { id:string; goal_type:'revenue'|'services'|'appointments'; title:string|null; target_value:number; period_start:string; period_end:string; active:boolean }

const defaultDashboardWidgets:DashboardWidget[]=['summary','business','appointments','requests','tomorrow','recovery','birthdays']
const dashboardWidgetOptions:{id:DashboardWidget;label:string;description:string;managerOnly?:boolean}[]=[
  {id:'summary',label:'Resumo do dia',description:'Marcações, pedidos e confirmações.'},
  {id:'business',label:'Gestão do negócio',description:'Atalho para dashboard, vendas e gestão.',managerOnly:true},
  {id:'sales',label:'Vendas do mês',description:'Faturação registada e ticket médio.',managerOnly:true},
  {id:'goals',label:'Objetivos',description:'Acompanhar o progresso das metas do negócio.',managerOnly:true},
  {id:'appointments',label:'Marcações de hoje',description:'Próximas marcações do dia.'},
  {id:'requests',label:'Pedidos online',description:'Pedidos que aguardam tratamento.'},
  {id:'tomorrow',label:'Confirmar amanhã',description:'Marcações de amanhã a confirmar.'},
  {id:'recovery',label:'Clientes a recuperar',description:'Clientes considerados adormecidos.'},
  {id:'birthdays',label:'Aniversários',description:'Aniversários dos próximos 7 dias.'},
  {id:'stock',label:'Stock baixo',description:'Produtos abaixo do mínimo.',managerOnly:true}
]

type Modal =
  | { kind:'appointment'; item?:Appointment; presetClient?:string; presetService?:string; presetDate?:string; presetTime?:string; bookingRequestId?:string }
  | { kind:'client'; item?:Client; prefill?:{name?:string; phone?:string} }
  | { kind:'clientDetail'; client:Client }
  | { kind:'visit'; appointment?:Appointment; client:Client }
  | { kind:'product'; item?:Product; barcode?:string }
  | { kind:'scanner' }
  | { kind:'invite' }
  | { kind:'staff' }
  | { kind:'services' }
  | { kind:'service'; item?:Service }
  | { kind:'siteSettings' }
  | { kind:'businessHub'; tab?:BusinessTab }
  | { kind:'dashboardCustomize' }
  | null

const locale = 'pt-PT'
const money = (value:number|string|null|undefined) => new Intl.NumberFormat(locale,{style:'currency',currency:'EUR'}).format(Number(value||0))
const todayISO = () => localISODate(new Date())
function localISODate(d:Date){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function dateLabel(iso:string){ return new Intl.DateTimeFormat(locale,{weekday:'long',day:'2-digit',month:'short'}).format(new Date(`${iso}T12:00:00`)) }
function addDays(iso:string,n:number){ const d=new Date(`${iso}T12:00:00`); d.setDate(d.getDate()+n); return localISODate(d) }
function startOfWeekISO(iso:string){ const d=new Date(`${iso}T12:00:00`); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); return localISODate(d) }
function addMonthsISO(iso:string,n:number){ const d=new Date(`${iso}T12:00:00`); d.setDate(1); d.setMonth(d.getMonth()+n); return localISODate(d) }
function monthLabel(iso:string){ return new Intl.DateTimeFormat(locale,{month:'long',year:'numeric'}).format(new Date(`${iso}T12:00:00`)) }
function hhmm(iso:string){ return new Intl.DateTimeFormat(locale,{hour:'2-digit',minute:'2-digit'}).format(new Date(iso)) }
function firstName(name:string){ return name.trim().split(/\s+/)[0] || name }
function weeksBetween(date:string){ return Math.floor((Date.now()-new Date(`${date}T12:00:00`).getTime())/(7*864e5)) }
function phoneDigits(phone:string|null){ return (phone||'').replace(/\D/g,'') }
function comparablePhone(phone:string|null){ const p=phoneDigits(phone); return p.length>9?p.slice(-9):p }
async function uploadSalonPublicImage(salonId:string,file:File,folder:'logo'|'services'){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Usa uma imagem JPG, PNG ou WebP.')
  if(file.size>5*1024*1024) throw new Error('A imagem deve ter no máximo 5 MB.')

  const {error:functionError}=await supabase.functions.invoke('ensure-salon-public-assets',{body:{salon_id:salonId}})
  if(functionError) throw new Error(functionError.message)

  const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg'
  const path=`${salonId}/${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`
  const {error:uploadError}=await supabase.storage.from('salon-public-assets').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type})
  if(uploadError) throw new Error(uploadError.message)
  const {data}=supabase.storage.from('salon-public-assets').getPublicUrl(path)
  return data.publicUrl
}
function whatsApp(phone:string|null,text:string){ const p=phoneDigits(phone); if(!p) return alert('Esta cliente não tem número de telemóvel.'); window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`,'_blank') }
function smsMessage(phone:string|null,text:string){ const p=phoneDigits(phone); if(!p) return alert('Esta cliente não tem número de telemóvel.'); const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent); window.location.href=`sms:${p}${isiOS?'&':'?'}body=${encodeURIComponent(text)}` }
function appointmentReminderMessage(clientName:string,serviceName:string,time:string){ return `Olá ${clientName},\n\nRelembramos que amanhã tem ${serviceName} agendado para amanhã às ${time}.\n\nObrigado` }
function birthdayMessage(clientName:string){ return `Olá ${firstName(clientName)},\n\nSó para te desejar um feliz aniversário! 🎉\nQue tenhas um excelente dia.\n\nObrigado` }
function isLeapYear(year:number){ return year%4===0 && (year%100!==0 || year%400===0) }
function nextBirthday(birthDate:string,from=new Date()){
  const parts=birthDate.split('-').map(Number)
  const month=parts[1], day=parts[2]
  if(!month||!day) return null
  const base=new Date(from.getFullYear(),from.getMonth(),from.getDate(),12,0,0,0)
  const make=(year:number)=>{
    const safeDay=month===2&&day===29&&!isLeapYear(year)?28:day
    return new Date(year,month-1,safeDay,12,0,0,0)
  }
  let date=make(base.getFullYear())
  if(date<base) date=make(base.getFullYear()+1)
  const daysUntil=Math.round((date.getTime()-base.getTime())/864e5)
  return {date,daysUntil}
}

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
  const [bookingRequests,setBookingRequests]=useState<BookingRequest[]>([])
  const [businessSettings,setBusinessSettings]=useState<BusinessSettings|null>(null)
  const [brandSettings,setBrandSettings]=useState<BrandSettings>({logo_url:null})
  const [dashboardWidgets,setDashboardWidgets]=useState<DashboardWidget[]>(defaultDashboardWidgets)
  const [salesSummary,setSalesSummary]=useState<SaleSummary[]>([])
  const [activeGoals,setActiveGoals]=useState<GoalSummary[]>([])
  const [menuOpen,setMenuOpen]=useState(false)
  const [businessMenuOpen,setBusinessMenuOpen]=useState(false)
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
    const [m,s,c,a,v,p,br,bs,dp,sa,go,ps]=await Promise.all([
      supabase.from('salon_members').select('*').eq('salon_id',salonId).eq('active',true).order('display_name'),
      supabase.from('services').select('*').eq('salon_id',salonId).eq('active',true).order('name'),
      supabase.from('clients').select('*').eq('salon_id',salonId).order('name'),
      supabase.from('appointments').select('*').eq('salon_id',salonId).order('starts_at'),
      supabase.from('visits').select('*').eq('salon_id',salonId).order('occurred_on',{ascending:false}),
      supabase.from('products').select('*').eq('salon_id',salonId).eq('active',true).order('name'),
      supabase.from('booking_requests').select('*').eq('salon_id',salonId).in('status',['new','contacted']).order('created_at',{ascending:false}),
      supabase.from('salon_business_settings').select('salon_id,dormant_after_weeks').eq('salon_id',salonId).maybeSingle(),
      supabase.from('dashboard_preferences').select('widgets').eq('salon_id',salonId).eq('member_id',membership.id).maybeSingle(),
      supabase.from('sales').select('id,occurred_at,total_amount').eq('salon_id',salonId).order('occurred_at',{ascending:false}),
      supabase.from('business_goals').select('id,goal_type,title,target_value,period_start,period_end,active').eq('salon_id',salonId).eq('active',true).order('period_end'),
      supabase.from('salon_public_settings').select('logo_url').eq('salon_id',salonId).maybeSingle()
    ])
    for(const result of [m,s,c,a,v,p,br,bs,dp,sa,go,ps]) if(result.error) showToast(result.error.message)
    setMembers((m.data||[]) as Member[]); setServices((s.data||[]) as Service[]); setClients((c.data||[]) as Client[])
    setAppointments((a.data||[]) as Appointment[]); setVisits((v.data||[]) as Visit[]); setProducts((p.data||[]) as Product[]); setBookingRequests((br.data||[]) as BookingRequest[]); setBusinessSettings((bs.data as BusinessSettings)||null)
    const prefWidgets=Array.isArray(dp.data?.widgets)?dp.data.widgets.filter((x:any)=>dashboardWidgetOptions.some(w=>w.id===x)) as DashboardWidget[]:[]
    setDashboardWidgets(prefWidgets.length?prefWidgets:defaultDashboardWidgets)
    setSalesSummary((sa.data||[]) as SaleSummary[])
    setActiveGoals((go.data||[]) as GoalSummary[])
    setBrandSettings({logo_url:ps.data?.logo_url||null})
  }

  function subscribeRealtime(){
    if(!membership) return ()=>{}
    const channel=supabase.channel(`salon-${membership.salon_id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'appointments',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'clients',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'visits',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'products',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'booking_requests',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'sales',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'business_goals',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'salon_public_settings',filter:`salon_id=eq.${membership.salon_id}`},()=>loadData())
      .subscribe()
    return ()=>{supabase.removeChannel(channel)}
  }

  function showToast(message:string){ setToast(message); window.setTimeout(()=>setToast(''),2600) }
  async function saveDashboardWidgets(widgets:DashboardWidget[]){
    if(!membership) return
    const clean=widgets.filter((x,i)=>dashboardWidgetOptions.some(w=>w.id===x)&&widgets.indexOf(x)===i)
    const {error}=await supabase.from('dashboard_preferences').upsert({
      salon_id:membership.salon_id,
      member_id:membership.id,
      widgets:clean,
      updated_at:new Date().toISOString()
    },{onConflict:'salon_id,member_id'})
    if(error){showToast(error.message);return}
    setDashboardWidgets(clean)
    setModal(null)
    showToast('Dashboard personalizado.')
  }
  async function updateBookingRequestStatus(id:string,status:'contacted'|'booked'|'closed'){
    const {error}=await supabase.from('booking_requests').update({status,updated_at:new Date().toISOString()}).eq('id',id)
    if(error) showToast(error.message); else { showToast('Pedido atualizado.'); await loadData() }
  }

  async function convertBookingRequest(request:BookingRequest){
    if(!membership) return
    let client=request.client_id?clients.find(x=>x.id===request.client_id):undefined
    if(!client){
      const targetPhone=comparablePhone(request.phone)
      client=clients.find(x=>targetPhone && comparablePhone(x.phone)===targetPhone)
    }

    if(!client){
      const {data:newClient,error}=await supabase.from('clients').insert({
        salon_id:membership.salon_id,
        name:request.name,
        phone:request.phone,
        email:null,
        birth_date:null,
        preferred_service_id:null,
        preferred_employee_id:null,
        recurrence_weeks:null,
        notes:null
      }).select('*').single()
      if(error){showToast('Não foi possível criar a ficha do cliente: '+error.message);return}
      client=newClient as Client
      setClients(prev=>[...prev.filter(x=>x.id!==client!.id),client!].sort((a,b)=>a.name.localeCompare(b.name)))
    }

    const service=services.find(s=>s.name.trim().toLowerCase()===request.service_name.trim().toLowerCase())
    await supabase.from('booking_requests').update({
      client_id:client.id,
      status:'contacted',
      updated_at:new Date().toISOString()
    }).eq('id',request.id)

    setBookingRequests(prev=>prev.map(x=>x.id===request.id?{...x,client_id:client!.id,status:'contacted'}:x))
    setModal({
      kind:'appointment',
      presetClient:client.id,
      presetService:service?.id,
      presetDate:request.preferred_date,
      presetTime:request.preferred_period==='morning'?'09:00':request.preferred_period==='afternoon'?'14:00':undefined,
      bookingRequestId:request.id
    })
  }
  const clientBy=(id:string)=>clients.find(x=>x.id===id)
  const serviceBy=(id:string|null)=>services.find(x=>x.id===id)
  const memberBy=(id:string)=>members.find(x=>x.id===id)

  const visibleAgenda = useMemo(()=>appointments.filter(a=>{
    const sameDay=localISODate(new Date(a.starts_at))===agendaDate
    const byPerson=!manager || agendaMode==='mine' ? a.employee_id===membership?.id : true
    return sameDay && byPerson && a.status!=='cancelled'
  }).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)),[appointments,agendaDate,agendaMode,manager,membership?.id])

  const todayAppointments=useMemo(()=>appointments.filter(a=>localISODate(new Date(a.starts_at))===todayISO() && a.status!=='cancelled').sort((a,b)=>a.starts_at.localeCompare(b.starts_at)),[appointments])
  const tomorrowAppointments=useMemo(()=>appointments.filter(a=>localISODate(new Date(a.starts_at))===addDays(todayISO(),1) && a.status!=='cancelled').sort((a,b)=>a.starts_at.localeCompare(b.starts_at)),[appointments])
  const upcomingBirthdays=useMemo(()=>clients.flatMap(client=>{
    if(!client.birth_date) return []
    const next=nextBirthday(client.birth_date)
    return next && next.daysUntil>=0 && next.daysUntil<=6 ? [{client,date:next.date,daysUntil:next.daysUntil}] : []
  }).sort((a,b)=>a.daysUntil-b.daysUntil||a.client.name.localeCompare(b.client.name)),[clients])

  const retention=useMemo(()=>clients.map(c=>{
    const history=visits.filter(v=>v.client_id===c.id).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on))
    const last=history[0]; if(!last) return null
    const due=Number(c.dormant_after_weeks || businessSettings?.dormant_after_weeks || c.recurrence_weeks || serviceBy(c.preferred_service_id)?.recurrence_weeks || 8)
    const passed=weeksBetween(last.occurred_on); const late=passed-due
    return {client:c,last,due,passed,late}
  }).filter(Boolean).filter((x:any)=>x.late>=0).sort((a:any,b:any)=>b.late-a.late) as {client:Client;last:Visit;due:number;passed:number;late:number}[],[clients,visits,services,businessSettings?.dormant_after_weeks])

  const lowStock=products.filter(p=>Number(p.current_stock)<=Number(p.min_stock))

  if(loading) return <div className="splash"><div className="brandMark">S</div><p>A carregar…</p></div>
  if(!isConfigured) return <SetupScreen />
  if(new URLSearchParams(window.location.search).get('barber')==='1') return <BarberDemo />
  if(new URLSearchParams(window.location.search).get('site')==='1') return <LandingPage onLogin={()=>{ window.location.href='/' }} />
  if(session && (passwordRecovery || session.user.user_metadata?.needs_password===true)) return <PasswordResetScreen inviteSetup={session.user.user_metadata?.needs_password===true} onDone={()=>{ setPasswordRecovery(false); const u=new URL(window.location.href); u.searchParams.delete('reset'); window.history.replaceState({},'',u.pathname+u.search+u.hash) }} onToast={showToast} />
  if(!session){ const loginRequested=new URLSearchParams(window.location.search).get('login')==='1'; return loginRequested?<AuthScreen onToast={showToast} />:<LandingPage onLogin={()=>{ window.location.href='/?login=1' }} /> }
  if(!membership) return <Onboarding onDone={loadMembership} onToast={showToast} />

  return <div className="appShell">
    <DesktopSidebar
      logoUrl={brandSettings.logo_url}
      salonName={salon?.name||'Salão'}
      membership={membership}
      view={view}
      manager={manager}
      businessOpen={businessMenuOpen}
      setBusinessOpen={setBusinessMenuOpen}
      onView={setView}
      onBusiness={tab=>setModal({kind:'businessHub',tab})}
      onWebsite={()=>{window.location.href='/?site=1'}}
      onSiteSettings={()=>setModal({kind:'siteSettings'})}
      onServices={()=>setModal({kind:'services'})}
      onCustomize={()=>setModal({kind:'dashboardCustomize'})}
      onLogout={()=>supabase.auth.signOut()}
    />
    <header className="topbar">
      <div className="topbarLeft">
        <div className="mobileHeaderBrand">
          <div className="mobileHeaderLogo">{brandSettings.logo_url?<img src={brandSettings.logo_url} alt={salon?.name||'Salão'}/>:<span>{initials(salon?.name||'Salão')}</span>}</div>
          <div className="mobileHeaderCopy"><span>{salon?.name||'SALÃO'}</span><strong>{titleFor(view)}</strong></div>
        </div>
        <div className="desktopHeaderCopy"><div className="eyebrow">{salon?.name||'SALÃO'}</div><h1>{titleFor(view)}</h1></div>
      </div>
      <div className="topbarActions">
        <button className="avatar" onClick={()=>setView('more')} aria-label="Abrir conta">{initials(membership.display_name)}</button>
        <button className={menuOpen?'appMenuToggle open':'appMenuToggle'} onClick={()=>setMenuOpen(v=>!v)} aria-label={menuOpen?'Fechar menu':'Abrir menu'} aria-expanded={menuOpen}>
          {menuOpen?<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>:<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>}
        </button>
      </div>
    </header>

    <AppMenu
      open={menuOpen}
      logoUrl={brandSettings.logo_url}
      salonName={salon?.name||'Salão'}
      manager={manager}
      businessOpen={businessMenuOpen}
      setBusinessOpen={setBusinessMenuOpen}
      onClose={()=>setMenuOpen(false)}
      onView={next=>{setView(next);setMenuOpen(false)}}
      onBusiness={tab=>{setModal({kind:'businessHub',tab});setMenuOpen(false)}}
      onWebsite={()=>{window.location.href='/?site=1'}}
      onSiteSettings={()=>{setModal({kind:'siteSettings'});setMenuOpen(false)}}
      onServices={()=>{setModal({kind:'services'});setMenuOpen(false)}}
      onCustomize={()=>{setModal({kind:'dashboardCustomize'});setMenuOpen(false)}}
    />

    <main className="content">
      {view==='today' && <TodayView manager={manager} widgets={dashboardWidgets} sales={salesSummary} goals={activeGoals} visits={visits} allAppointments={appointments} clients={clients} appointments={todayAppointments} tomorrowAppointments={tomorrowAppointments} bookingRequests={bookingRequests} upcomingBirthdays={upcomingBirthdays} retention={retention} lowStock={lowStock} clientBy={clientBy} serviceBy={serviceBy} memberBy={memberBy} salonName={salon?.name||'Salão'} onNew={()=>setModal({kind:'appointment'})} onClient={c=>setModal({kind:'clientDetail',client:c})} onBook={c=>setModal({kind:'appointment',presetClient:c.id})} onBookingStatus={updateBookingRequestStatus} onBookingSchedule={convertBookingRequest} onBusinessHub={tab=>setModal({kind:'businessHub',tab:tab||'dashboard'})} onCustomize={()=>setModal({kind:'dashboardCustomize'})} />}
      {view==='agenda' && <AgendaView date={agendaDate} setDate={setAgendaDate} items={visibleAgenda} appointments={appointments} members={members} manager={manager} mode={agendaMode} setMode={setAgendaMode} membership={membership} clientBy={clientBy} serviceBy={serviceBy} memberBy={memberBy} onNew={()=>setModal({kind:'appointment',presetDate:agendaDate})} onOpen={a=>setModal({kind:'appointment',item:a})} onICS={a=>downloadICS(a,clientBy(a.client_id),serviceBy(a.service_id),memberBy(a.employee_id))} />}
      {view==='clients' && <ClientsView clients={clients} visits={visits} query={clientQuery} setQuery={setClientQuery} onNew={()=>startClientCreate(setModal,showToast)} onOpen={c=>setModal({kind:'clientDetail',client:c})} />}
      {view==='alerts' && <AlertsView retention={retention} lowStock={lowStock} onBook={c=>setModal({kind:'appointment',presetClient:c.id})} />}
      {view==='stock' && <StockView products={products} query={stockQuery} setQuery={setStockQuery} onScan={()=>setModal({kind:'scanner'})} onNew={()=>setModal({kind:'product'})} onEdit={p=>setModal({kind:'product',item:p})} onChange={changeStock} />}
      {view==='more' && <MoreView membership={membership} salon={salon} manager={manager} onWebsite={()=>{window.location.href='/?site=1'}} onBusinessHub={()=>setModal({kind:'businessHub',tab:'dashboard'})} onSiteSettings={()=>setModal({kind:'siteSettings'})} onServices={()=>setModal({kind:'services'})} onAddStaff={()=>setModal({kind:'staff'})} onInvite={()=>setModal({kind:'invite'})} onLogout={()=>supabase.auth.signOut()} />}
    </main>

    <nav className="bottomNav">
      {(['today','agenda','clients','alerts','stock'] as View[]).map(v=><button key={v} className={view===v?'active':''} onClick={()=>setView(v)}><span className="navGlyph"><NavGlyph view={v}/></span><small>{navLabel(v)}</small></button>)}
    </nav>

    {modal && <ModalLayer modal={modal} close={()=>setModal(null)} membership={membership} members={members} services={services} clients={clients} appointments={appointments} visits={visits} products={products} clientBy={clientBy} serviceBy={serviceBy} memberBy={memberBy} manager={manager} dashboardWidgets={dashboardWidgets} onDashboardSaved={saveDashboardWidgets} onSaved={async(message)=>{setModal(null);showToast(message);await loadData()}} onOpen={(m)=>setModal(m)} onDataChanged={loadData} />}
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

function DesktopSidebar({logoUrl,salonName,membership,view,manager,businessOpen,setBusinessOpen,onView,onBusiness,onWebsite,onSiteSettings,onServices,onCustomize,onLogout}:{logoUrl:string|null;salonName:string;membership:Member;view:View;manager:boolean;businessOpen:boolean;setBusinessOpen:(v:boolean)=>void;onView:(v:View)=>void;onBusiness:(tab:BusinessTab)=>void;onWebsite:()=>void;onSiteSettings:()=>void;onServices:()=>void;onCustomize:()=>void;onLogout:()=>void}){
  const mainItems:{id:View;label:string;icon:string}[]=[
    {id:'today',label:'Painel',icon:'⌂'},
    {id:'agenda',label:'Agenda',icon:'□'},
    {id:'clients',label:'Clientes',icon:'♙'},
    {id:'alerts',label:'Alertas',icon:'!'},
    {id:'stock',label:'Stock',icon:'▤'}
  ]
  const businessItems:{tab:BusinessTab;label:string}[]=[
    {tab:'dashboard',label:'Dashboard'},
    {tab:'booking',label:'Marcações'},
    {tab:'team',label:'Equipa e horários'},
    {tab:'dormant',label:'Clientes adormecidos'},
    {tab:'loyalty',label:'Fidelização'},
    {tab:'sales',label:'Vendas e comissões'},
    {tab:'goals',label:'Objetivos'}
  ]
  return <aside className="desktopSidebar">
    <div className="desktopBrand">
      <div className="desktopBrandLogo">
        {logoUrl?<img src={logoUrl} alt={salonName}/>:<span>{initials(salonName)}</span>}
      </div>
      <div className="desktopBrandText"><strong>{salonName}</strong><span>Gestão do negócio</span></div>
    </div>

    <nav className="desktopNav">
      {mainItems.map(item=><button key={item.id} className={view===item.id?'desktopNavItem active':'desktopNavItem'} onClick={()=>onView(item.id)}><span className="desktopNavIcon">{item.icon}</span><strong>{item.label}</strong></button>)}
      {manager&&<div className="desktopNavGroup">
        <button className={businessOpen?'desktopNavItem group active':'desktopNavItem group'} onClick={()=>setBusinessOpen(!businessOpen)}><span className="desktopNavIcon">◫</span><strong>Gestão do negócio</strong><b>{businessOpen?'⌃':'⌄'}</b></button>
        {businessOpen&&<div className="desktopNavSub">{businessItems.map(item=><button key={item.tab} onClick={()=>onBusiness(item.tab)}>{item.label}</button>)}</div>}
      </div>}
      {manager&&<button className="desktopNavItem" onClick={onServices}><span className="desktopNavIcon">◇</span><strong>Serviços</strong></button>}
      {manager&&<button className="desktopNavItem" onClick={onSiteSettings}><span className="desktopNavIcon">▣</span><strong>Site</strong></button>}
      <button className="desktopNavItem" onClick={onCustomize}><span className="desktopNavIcon">☷</span><strong>Personalizar</strong></button>
    </nav>

    <div className="desktopSidebarBottom">
      <button className="desktopSiteLink" onClick={onWebsite}>← Ver site</button>
      <div className="desktopUser">
        <div className="desktopUserAvatar">{initials(membership.display_name)}</div>
        <div><strong>{membership.display_name}</strong><span>{roleLabel(membership.role)}</span></div>
      </div>
      <button className="desktopLogout" onClick={onLogout}>Sair</button>
    </div>
  </aside>
}

function AppMenu({open,logoUrl,salonName,manager,businessOpen,setBusinessOpen,onClose,onView,onBusiness,onWebsite,onSiteSettings,onServices,onCustomize}:{open:boolean;logoUrl:string|null;salonName:string;manager:boolean;businessOpen:boolean;setBusinessOpen:(v:boolean)=>void;onClose:()=>void;onView:(v:View)=>void;onBusiness:(tab:BusinessTab)=>void;onWebsite:()=>void;onSiteSettings:()=>void;onServices:()=>void;onCustomize:()=>void}){
  if(!open) return null
  const navItems:[View,string,string][]=[
    ['today','Hoje','Resumo e prioridades do dia'],
    ['agenda','Agenda','Marcações e disponibilidade'],
    ['clients','Clientes','CRM, histórico e preferências'],
    ['alerts','Alertas','Retenção e stock'],
    ['stock','Stock','Produtos e movimentos']
  ]
  const businessItems:{tab:BusinessTab;label:string}[]=[
    {tab:'dashboard',label:'Dashboard'},
    {tab:'booking',label:'Marcações'},
    {tab:'team',label:'Equipa e horários'},
    {tab:'dormant',label:'Clientes adormecidos'},
    {tab:'loyalty',label:'Fidelização'},
    {tab:'sales',label:'Vendas e comissões'},
    {tab:'goals',label:'Objetivos'}
  ]
  return <div className="appMenuBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <aside className="appMenuPanel">
      <div className="appMenuBrand">
        <div className="appMenuBrandLogo">{logoUrl?<img src={logoUrl} alt={salonName}/>:<span>{initials(salonName)}</span>}</div>
        <div><strong>{salonName}</strong><span>Gestão do negócio</span></div>
      </div>
      <div className="appMenuHead"><strong>Navegação</strong><button className="iconButton" onClick={onClose}>×</button></div>
      <div className="appMenuList">
        {navItems.map(([id,label,desc])=><button key={id} className="appMenuItem" onClick={()=>onView(id)}><div><strong>{label}</strong><span>{desc}</span></div><b>›</b></button>)}
        {manager&&<div className="appMenuGroup">
          <button className={businessOpen?'appMenuItem groupOpen':'appMenuItem'} onClick={()=>setBusinessOpen(!businessOpen)}><div><strong>Gestão do negócio</strong><span>Dashboard, objetivos, equipa, fidelização e vendas</span></div><b>{businessOpen?'⌃':'⌄'}</b></button>
          {businessOpen&&<div className="appMenuSub">{businessItems.map(item=><button key={item.tab} onClick={()=>onBusiness(item.tab)}>{item.label}<span>›</span></button>)}</div>}
        </div>}
        <button className="appMenuItem" onClick={onCustomize}><div><strong>Personalizar página inicial</strong><span>Escolher e ordenar widgets</span></div><b>›</b></button>
        {manager&&<button className="appMenuItem" onClick={onServices}><div><strong>Serviços</strong><span>Preços, duração e imagens</span></div><b>›</b></button>}
        {manager&&<button className="appMenuItem" onClick={onSiteSettings}><div><strong>Website e contactos</strong><span>Identidade e contactos públicos</span></div><b>›</b></button>}
        <button className="appMenuItem" onClick={onWebsite}><div><strong>Ver website</strong><span>Abrir a página pública</span></div><b>↗</b></button>
      </div>
    </aside>
  </div>
}

function TodayView({manager,widgets,sales,goals,visits,allAppointments,clients,appointments,tomorrowAppointments,bookingRequests,upcomingBirthdays,retention,lowStock,clientBy,serviceBy,memberBy,salonName,onNew,onClient,onBook,onBookingStatus,onBookingSchedule,onBusinessHub,onCustomize}:{manager:boolean;widgets:DashboardWidget[];sales:SaleSummary[];goals:GoalSummary[];visits:Visit[];allAppointments:Appointment[];clients:Client[];appointments:Appointment[];tomorrowAppointments:Appointment[];bookingRequests:BookingRequest[];upcomingBirthdays:{client:Client;date:Date;daysUntil:number}[];retention:any[];lowStock:Product[];clientBy:(id:string)=>Client|undefined;serviceBy:(id:string|null)=>Service|undefined;memberBy:(id:string)=>Member|undefined;salonName:string;onNew:()=>void;onClient:(c:Client)=>void;onBook:(c:Client)=>void;onBookingStatus:(id:string,status:'contacted'|'booked'|'closed')=>void;onBookingSchedule:(request:BookingRequest)=>void;onBusinessHub:(tab?:BusinessTab)=>void;onCustomize:()=>void}){
  const currentMonth=localISODate(new Date()).slice(0,7)
  const monthSales=sales.filter(s=>localISODate(new Date(s.occurred_at)).startsWith(currentMonth))
  const revenue=monthSales.reduce((n,s)=>n+Number(s.total_amount||0),0)
  const ticket=monthSales.length?revenue/monthSales.length:0
  const ordered=widgets.filter(id=>!(dashboardWidgetOptions.find(x=>x.id===id)?.managerOnly&&!manager))

  function renderWidget(id:DashboardWidget){
    if(id==='summary') return <div className="dashboardWidget dashboardWidgetSummary" key={id}>
      <div className="dashboardWidgetHead"><div><span>Hoje</span><h2>Resumo do dia</h2></div><button className="textButton dashboardEdit" onClick={onCustomize}>Personalizar</button></div>
      <div className="kpis"><Kpi label="Hoje" value={appointments.length} sub="marcações"/><Kpi label="Pedidos" value={bookingRequests.filter(r=>r.status==='new').length} sub="online"/><Kpi label="Confirmar" value={tomorrowAppointments.length} sub="amanhã"/></div>
    </div>

    if(id==='business'&&manager) return <button className="businessShortcut" key={id} onClick={()=>onBusinessHub('dashboard')}>
      <div className="businessShortcutIcon">◫</div><div><span>GESTÃO DO NEGÓCIO</span><strong>Dashboard, objetivos, vendas, fidelização e equipa</strong><small>Gerir operação e acompanhar resultados</small></div><b>›</b>
    </button>

    if(id==='sales'&&manager) return <section className="dashboardWidget" key={id}>
      <div className="dashboardWidgetHead"><div><span>Este mês</span><h2>Vendas</h2></div><button className="mini" onClick={()=>onBusinessHub('sales')}>Abrir gestão</button></div>
      <div className="dashboardSalesGrid"><div><span>Faturação registada</span><strong>{money(revenue)}</strong></div><div><span>Ticket médio</span><strong>{money(ticket)}</strong></div><div><span>Vendas</span><strong>{monthSales.length}</strong></div></div>
    </section>

    if(id==='goals'&&manager) return <section className="dashboardWidget dashboardGoalsWidget" key={id}>
      <div className="dashboardWidgetHead"><div><span>Performance</span><h2>Objetivos</h2></div><button className="mini" onClick={()=>onBusinessHub('goals')}>Gerir</button></div>
      {goals.length?<div className="homeGoalList">{goals.slice(0,3).map(goal=>{
        const current=goal.goal_type==='revenue'
          ? sales.filter(s=>localISODate(new Date(s.occurred_at))>=goal.period_start&&localISODate(new Date(s.occurred_at))<=goal.period_end).reduce((n,s)=>n+Number(s.total_amount||0),0)
          : goal.goal_type==='services'
            ? visits.filter(v=>v.occurred_on>=goal.period_start&&v.occurred_on<=goal.period_end).length
            : allAppointments.filter(a=>a.status==='completed'&&localISODate(new Date(a.starts_at))>=goal.period_start&&localISODate(new Date(a.starts_at))<=goal.period_end).length
        const pct=Math.min(100,Math.round(current/Number(goal.target_value)*100))
        const label=goal.title||(goal.goal_type==='revenue'?'Faturação':goal.goal_type==='services'?'Serviços':'Marcações')
        return <div className="homeGoalRow" key={goal.id}><div><strong>{label}</strong><span>{goal.goal_type==='revenue'?money(current):current} de {goal.goal_type==='revenue'?money(goal.target_value):Number(goal.target_value)}</span></div><div className="homeGoalProgress"><i style={{width:`${pct}%`}}/></div><b>{pct}%</b></div>
      })}</div>:<div className="empty">Ainda não existem objetivos ativos.</div>}
    </section>

    if(id==='requests') return <Section key={id} title={`Pedidos online (${bookingRequests.length})`}>
      {bookingRequests.length?bookingRequests.map(r=>{const targetPhone=comparablePhone(r.phone);const linked=(r.client_id?clients.find(c=>c.id===r.client_id):undefined)||clients.find(c=>targetPhone&&comparablePhone(c.phone)===targetPhone);return <BookingRequestCard key={r.id} request={r} client={linked} onStatus={onBookingStatus} onSchedule={()=>onBookingSchedule(r)} onClient={()=>linked&&onClient(linked)}/> }):<Empty>Sem pedidos de marcação pendentes.</Empty>}
    </Section>

    if(id==='tomorrow') return <Section key={id} title={`Confirmar amanhã (${tomorrowAppointments.length})`}>
      {tomorrowAppointments.length?tomorrowAppointments.map(a=>{const client=clientBy(a.client_id),service=serviceBy(a.service_id),member=memberBy(a.employee_id);return <TomorrowConfirmationCard key={a.id} a={a} c={client} s={service} m={member} onClient={()=>client&&onClient(client)} />}):<Empty>Sem marcações para confirmar amanhã.</Empty>}
    </Section>

    if(id==='birthdays') return <Section key={id} title={`Aniversários — próximos 7 dias (${upcomingBirthdays.length})`}>
      {upcomingBirthdays.length?upcomingBirthdays.map(item=><BirthdayCard key={item.client.id} client={item.client} date={item.date} daysUntil={item.daysUntil} onClient={()=>onClient(item.client)} />):<Empty>Sem aniversários nos próximos 7 dias.</Empty>}
    </Section>

    if(id==='appointments') return <Section key={id} title="Marcações de hoje">{appointments.length?appointments.slice(0,6).map(a=><AppointmentCard key={a.id} a={a} c={clientBy(a.client_id)} s={serviceBy(a.service_id)} m={memberBy(a.employee_id)} salonName={salonName} onClient={()=>clientBy(a.client_id)&&onClient(clientBy(a.client_id)!)} />):<Empty>Sem marcações para hoje.</Empty>}</Section>

    if(id==='recovery') return <Section key={id} title="Clientes a recuperar">{retention.length?retention.slice(0,5).map((r:any)=><RetentionCard key={r.client.id} r={r} onBook={()=>onBook(r.client)}/>):<Empty>Nenhuma cliente em atraso.</Empty>}</Section>

    if(id==='stock'&&manager) return <section className="dashboardWidget" key={id}>
      <div className="dashboardWidgetHead"><div><span>Inventário</span><h2>Stock baixo</h2></div></div>
      {lowStock.length?<div className="dashboardCompactList">{lowStock.slice(0,5).map(p=><div key={p.id}><strong>{p.name}</strong><span>{p.current_stock} {p.unit} · mínimo {p.min_stock}</span></div>)}</div>:<Empty>Sem produtos abaixo do stock mínimo.</Empty>}
    </section>
    return null
  }

  return <>
    <div className="dateStrip dashboardDateStrip"><div><div className="muted cap">{dateLabel(todayISO()).split(',')[0]}</div><strong>{new Intl.DateTimeFormat(locale,{day:'2-digit',month:'long'}).format(new Date())}</strong></div><button className="primary small" onClick={onNew}>+ Marcação</button></div>
    <div className="dashboardCanvas">{ordered.map(renderWidget)}</div>
    {!ordered.length&&<div className="dashboardEmpty"><strong>A tua página inicial está vazia.</strong><span>Escolhe os widgets que queres acompanhar.</span><button className="primary" onClick={onCustomize}>Personalizar dashboard</button></div>}
  </>
}

function AgendaView({date,setDate,items,appointments,members,manager,mode,setMode,membership,clientBy,serviceBy,memberBy,onNew,onOpen,onICS}:{date:string;setDate:(s:string)=>void;items:Appointment[];appointments:Appointment[];members:Member[];manager:boolean;mode:'mine'|'team';setMode:(m:'mine'|'team')=>void;membership:Member;clientBy:(id:string)=>Client|undefined;serviceBy:(id:string|null)=>Service|undefined;memberBy:(id:string)=>Member|undefined;onNew:()=>void;onOpen:(a:Appointment)=>void;onICS:(a:Appointment)=>void}){
  const [viewMode,setViewMode]=useState<'day'|'week'|'month'>('day')
  const personFiltered=useMemo(()=>appointments.filter(a=>{
    if(a.status==='cancelled') return false
    if(!manager || mode==='mine') return a.employee_id===membership.id
    return true
  }),[appointments,manager,mode,membership.id])

  const weekStart=startOfWeekISO(date)
  const weekDays=Array.from({length:7},(_,i)=>addDays(weekStart,i))
  const monthDate=new Date(`${date}T12:00:00`)
  const monthStart=new Date(monthDate.getFullYear(),monthDate.getMonth(),1,12)
  const monthStartIso=localISODate(monthStart)
  const monthGridStart=startOfWeekISO(monthStartIso)
  const monthDays=Array.from({length:42},(_,i)=>addDays(monthGridStart,i))

  function changePeriod(direction:number){
    if(viewMode==='day') setDate(addDays(date,direction))
    else if(viewMode==='week') setDate(addDays(date,direction*7))
    else setDate(addMonthsISO(date,direction))
  }

  function openDay(iso:string){
    setDate(iso)
    setViewMode('day')
  }

  function appointmentsForDay(iso:string){
    return personFiltered.filter(a=>localISODate(new Date(a.starts_at))===iso).sort((a,b)=>a.starts_at.localeCompare(b.starts_at))
  }

  const periodTitle=viewMode==='day'?dateLabel(date):viewMode==='week'
    ? `${new Intl.DateTimeFormat(locale,{day:'2-digit',month:'short'}).format(new Date(`${weekDays[0]}T12:00:00`))} — ${new Intl.DateTimeFormat(locale,{day:'2-digit',month:'short'}).format(new Date(`${weekDays[6]}T12:00:00`))}`
    : monthLabel(date)

  return <>
    <div className="agendaViewSwitch">
      <button className={viewMode==='day'?'active':''} onClick={()=>setViewMode('day')}>Dia</button>
      <button className={viewMode==='week'?'active':''} onClick={()=>setViewMode('week')}>Semana</button>
      <button className={viewMode==='month'?'active':''} onClick={()=>setViewMode('month')}>Mês</button>
    </div>

    <div className="agendaPeriodBar">
      <button className="iconButton" onClick={()=>changePeriod(-1)}>‹</button>
      <button className="periodTitle" onClick={()=>setDate(todayISO())}>{periodTitle}</button>
      <button className="iconButton" onClick={()=>changePeriod(1)}>›</button>
      <button className="primary small" onClick={onNew}>+ Nova marcação</button>
    </div>

    {manager&&<div className="segmented agendaPeopleSwitch"><button className={mode==='mine'?'active':''} onClick={()=>setMode('mine')}>Minha agenda</button><button className={mode==='team'?'active':''} onClick={()=>setMode('team')}>Equipa</button></div>}
    {manager&&mode==='team'&&<div className="agendaTeamLegend">{members.map(m=><span key={m.id}><i style={{background:m.calendar_color||'#6F8FAF'}}/>{m.display_name}</span>)}</div>}

    {viewMode==='day'&&<>
      <div className="dayTitle">{dateLabel(date)}{!manager&&<span className="tag">{membership.display_name}</span>}</div>
      <div className="timeline">{items.length?items.map(a=>{const client=clientBy(a.client_id),service=serviceBy(a.service_id),member=memberBy(a.employee_id);return <div className="timeRow" key={a.id}><div className="time">{hhmm(a.starts_at)}</div><article className="bookingCard memberColorCard" style={{'--member-color':member?.calendar_color||'#6F8FAF'} as CSSProperties}><button className="bookingMain" onClick={()=>onOpen(a)}><strong>{client?.name||'Cliente'}</strong><span><i className="memberColorDot" style={{background:member?.calendar_color||'#6F8FAF'}}/>{service?.name||'Serviço'} · {member?.display_name}</span>{a.notes&&<small>{a.notes}</small>}</button><button className="calendarBtn" onClick={()=>onICS(a)} title="Adicionar ao calendário">▣</button></article></div>}):<Empty>Sem marcações neste dia.</Empty>}</div>
    </>}

    {viewMode==='week'&&<div className="weekAgenda">
      {weekDays.map(day=>{
        const dayItems=appointmentsForDay(day)
        const isToday=day===todayISO()
        return <section className={`weekDayCard ${isToday?'today':''}`} key={day}>
          <button className="weekDayHead" onClick={()=>openDay(day)}>
            <div><strong>{new Intl.DateTimeFormat(locale,{weekday:'short'}).format(new Date(`${day}T12:00:00`))}</strong><span>{new Intl.DateTimeFormat(locale,{day:'2-digit',month:'short'}).format(new Date(`${day}T12:00:00`))}</span></div>
            <span className="tag">{dayItems.length}</span>
          </button>
          {dayItems.length?<div className="weekBookings">{dayItems.map(a=>{
            const client=clientBy(a.client_id),service=serviceBy(a.service_id),member=memberBy(a.employee_id)
            return <button className="weekBooking memberColorCard" style={{'--member-color':member?.calendar_color||'#6F8FAF'} as CSSProperties} key={a.id} onClick={()=>onOpen(a)}><span>{hhmm(a.starts_at)}</span><div><strong>{client?.name||'Cliente'}</strong><small><i className="memberColorDot" style={{background:member?.calendar_color||'#6F8FAF'}}/>{service?.name||'Serviço'} · {member?.display_name||''}</small></div></button>
          })}</div>:<div className="weekEmpty">Sem marcações</div>}
        </section>
      })}
    </div>}

    {viewMode==='month'&&<div className="monthCalendar">
      <div className="monthWeekdays">{['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(d=><span key={d}>{d}</span>)}</div>
      <div className="monthGrid">{monthDays.map(day=>{
        const dayAppointments=appointmentsForDay(day)
        const count=dayAppointments.length
        const memberColors=[...new Set(dayAppointments.map(a=>memberBy(a.employee_id)?.calendar_color||'#6F8FAF'))].slice(0,4)
        const d=new Date(`${day}T12:00:00`)
        const outside=d.getMonth()!==monthDate.getMonth()
        const isToday=day===todayISO()
        const selected=day===date
        return <button key={day} className={`monthDay ${outside?'outside':''} ${isToday?'today':''} ${selected?'selected':''}`} onClick={()=>openDay(day)}>
          <span className="monthDayNumber">{d.getDate()}</span>
          {count>0&&<><span className="monthCount">{count}</span><span className="monthMemberDots">{memberColors.map((color,index)=><i key={index} style={{background:color}}/>)}</span></>}
        </button>
      })}</div>
      <div className="monthLegend">Toca num dia para abrir a agenda diária.</div>
    </div>}
  </>
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

function MoreView({membership,salon,manager,onWebsite,onBusinessHub,onSiteSettings,onServices,onAddStaff,onInvite,onLogout}:{membership:Member;salon:Salon|null;manager:boolean;onWebsite:()=>void;onBusinessHub:()=>void;onSiteSettings:()=>void;onServices:()=>void;onAddStaff:()=>void;onInvite:()=>void;onLogout:()=>void}){
  return <div className="stack">
    <div className="profileCard"><div className="bigAvatar">{initials(membership.display_name)}</div><div><strong>{membership.display_name}</strong><span>{roleLabel(membership.role)} · {salon?.name}</span></div></div>
    <button className="menuCard" onClick={onWebsite}><span>↗</span><div><strong>Ver website</strong><small>Pré-visualizar a homepage pública do salão.</small></div><b>›</b></button>
    {manager&&<button className="menuCard" onClick={onBusinessHub}><span>◫</span><div><strong>Gestão do negócio</strong><small>Dashboard, marcações, horários, retenção, fidelização e vendas.</small></div><b>›</b></button>}
    {manager&&<button className="menuCard" onClick={onSiteSettings}><span>⚙︎</span><div><strong>Website e contactos</strong><small>WhatsApp, Instagram, morada e telefone visíveis no website.</small></div><b>›</b></button>}
    {manager&&<button className="menuCard" onClick={onServices}><span>✂︎</span><div><strong>Serviços</strong><small>Preços, duração e recorrência dos serviços do salão.</small></div><b>›</b></button>}
    {manager&&<button className="menuCard" onClick={onAddStaff}><span>👤</span><div><strong>Adicionar profissional sem acesso</strong><small>Cria um profissional para receber marcações, sem email, password ou login.</small></div><b>›</b></button>}
    {manager&&<button className="menuCard" onClick={onInvite}><span>👥</span><div><strong>Convidar colaborador com acesso</strong><small>Envia um convite por email para usar a aplicação.</small></div><b>›</b></button>}
    <button className="menuCard" onClick={onLogout}><span>↪</span><div><strong>Terminar sessão</strong><small>Sair deste dispositivo.</small></div><b>›</b></button>
  </div>
}

function ModalLayer({modal,close,membership,members,services,clients,appointments,visits,products,clientBy,serviceBy,memberBy,manager,dashboardWidgets,onDashboardSaved,onSaved,onOpen,onDataChanged}:{modal:Exclude<Modal,null>;close:()=>void;membership:Member;members:Member[];services:Service[];clients:Client[];appointments:Appointment[];visits:Visit[];products:Product[];clientBy:(id:string)=>Client|undefined;serviceBy:(id:string|null)=>Service|undefined;memberBy:(id:string)=>Member|undefined;manager:boolean;dashboardWidgets:DashboardWidget[];onDashboardSaved:(widgets:DashboardWidget[])=>void|Promise<void>;onSaved:(m:string)=>void;onOpen:(m:Modal)=>void;onDataChanged:()=>void|Promise<void>}){
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="modalCard"><div className="modalHead"><h2>{modalTitle(modal)}</h2><button className="iconButton" onClick={close}>×</button></div>{modal.kind==='appointment'&&<AppointmentForm item={modal.item} presetClient={modal.presetClient} presetService={modal.presetService} presetDate={modal.presetDate} presetTime={modal.presetTime} membership={membership} members={members} services={services} clients={clients} appointments={appointments} manager={manager} onSaved={async message=>{if(modal.bookingRequestId)await supabase.from('booking_requests').update({status:'booked',updated_at:new Date().toISOString()}).eq('id',modal.bookingRequestId);onSaved(message)}} onVisit={a=>onOpen({kind:'visit',appointment:a,client:clientBy(a.client_id)!})} onDelete={async a=>{const {error}=await supabase.from('appointments').update({status:'cancelled'}).eq('id',a.id); if(error)alert(error.message); else onSaved('Marcação cancelada.')}} />}{modal.kind==='client'&&<ClientForm item={modal.item} prefill={modal.prefill} membership={membership} services={services} members={members} onSaved={onSaved} />}{modal.kind==='clientDetail'&&<ClientDetail client={modal.client} appointments={appointments} visits={visits} services={services} memberBy={memberBy} onEdit={()=>onOpen({kind:'client',item:modal.client})} onBook={()=>onOpen({kind:'appointment',presetClient:modal.client.id})} onVisit={()=>onOpen({kind:'visit',client:modal.client})} />}{modal.kind==='visit'&&<VisitForm client={modal.client} appointment={modal.appointment} membership={membership} serviceBy={serviceBy} onSaved={onSaved} />}{modal.kind==='product'&&<ProductForm item={modal.item} barcode={modal.barcode} membership={membership} onSaved={onSaved} />}{modal.kind==='scanner'&&<Scanner onFound={code=>{const existing=products.find(p=>p.barcode===code); onOpen(existing?{kind:'product',item:existing}:{kind:'product',barcode:code})}} />}{modal.kind==='staff'&&<StaffForm onSaved={onSaved} />}{modal.kind==='invite'&&<InviteForm onSaved={onSaved} />}{modal.kind==='services'&&<ServicesManager services={services} onNew={()=>onOpen({kind:'service'})} onEdit={service=>onOpen({kind:'service',item:service})} />}{modal.kind==='service'&&<ServiceForm item={modal.item} membership={membership} onSaved={onSaved} />}{modal.kind==='siteSettings'&&<SiteSettingsForm membership={membership} onSaved={onSaved} />}{modal.kind==='businessHub'&&<BusinessHub membership={membership} members={members} clients={clients} services={services} appointments={appointments} visits={visits} onChanged={onDataChanged} initialTab={modal.tab||'dashboard'} />}{modal.kind==='dashboardCustomize'&&<DashboardCustomizer widgets={dashboardWidgets} manager={manager} onSave={onDashboardSaved} />}</div></div>
}

function DashboardCustomizer({widgets,manager,onSave}:{widgets:DashboardWidget[];manager:boolean;onSave:(widgets:DashboardWidget[])=>void|Promise<void>}){
  const allowed=dashboardWidgetOptions.filter(x=>!x.managerOnly||manager)
  const [selected,setSelected]=useState<DashboardWidget[]>(widgets.filter(id=>allowed.some(x=>x.id===id)))
  const [busy,setBusy]=useState(false)

  function toggle(id:DashboardWidget){
    setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id])
  }
  function move(id:DashboardWidget,direction:-1|1){
    setSelected(current=>{
      const index=current.indexOf(id)
      const target=index+direction
      if(index<0||target<0||target>=current.length)return current
      const next=[...current]; [next[index],next[target]]=[next[target],next[index]]
      return next
    })
  }
  async function save(){
    setBusy(true)
    await onSave(selected)
    setBusy(false)
  }

  return <div className="dashboardCustomizer">
    <p className="muted">Escolhe o que queres ver quando abres a aplicação. A configuração fica guardada apenas para o teu utilizador.</p>
    <div className="dashboardCustomizerList">
      {allowed.map(option=>{
        const active=selected.includes(option.id)
        const position=selected.indexOf(option.id)
        return <div className={active?'dashboardCustomizerRow active':'dashboardCustomizerRow'} key={option.id}>
          <label><input type="checkbox" checked={active} onChange={()=>toggle(option.id)}/><div><strong>{option.label}</strong><span>{option.description}</span></div></label>
          {active&&<div className="widgetOrderButtons">
            <button type="button" disabled={position<=0} onClick={()=>move(option.id,-1)} aria-label="Mover para cima">↑</button>
            <button type="button" disabled={position===selected.length-1} onClick={()=>move(option.id,1)} aria-label="Mover para baixo">↓</button>
          </div>}
        </div>
      })}
    </div>
    <div className="dashboardPreviewOrder"><span>Ordem:</span>{selected.map(id=><b key={id}>{dashboardWidgetOptions.find(x=>x.id===id)?.label}</b>)}</div>
    <button className="primary full" disabled={busy} onClick={()=>void save()}>{busy?'A guardar…':'Guardar página inicial'}</button>
  </div>
}


function SiteSettingsForm({membership,onSaved}:{membership:Member;onSaved:(m:string)=>void}){
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [uploading,setUploading]=useState(false)
  const [values,setValues]=useState({whatsapp_phone:'',instagram_url:'',address:'',public_phone:'',logo_url:''})

  useEffect(()=>{
    let alive=true
    supabase.from('salon_public_settings').select('whatsapp_phone,instagram_url,address,public_phone,logo_url').eq('salon_id',membership.salon_id).maybeSingle().then(({data,error})=>{
      if(!alive) return
      if(error) alert(error.message)
      if(data) setValues({
        whatsapp_phone:data.whatsapp_phone||'',
        instagram_url:data.instagram_url||'',
        address:data.address||'',
        public_phone:data.public_phone||'',
        logo_url:data.logo_url||''
      })
      setLoading(false)
    })
    return ()=>{alive=false}
  },[membership.salon_id])

  function set(key:keyof typeof values,value:string){setValues(v=>({...v,[key]:value}))}

  async function uploadLogo(file?:File){
    if(!file) return
    setUploading(true)
    try{
      const url=await uploadSalonPublicImage(membership.salon_id,file,'logo')
      set('logo_url',url)
    }catch(err:any){alert(err?.message||'Não foi possível carregar o logótipo.')}
    finally{setUploading(false)}
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    setBusy(true)
    let instagram=values.instagram_url.trim()
    if(instagram && !/^https?:\/\//i.test(instagram)) instagram='https://'+instagram
    const payload={
      salon_id:membership.salon_id,
      whatsapp_phone:values.whatsapp_phone.trim()||null,
      instagram_url:instagram||null,
      address:values.address.trim()||null,
      public_phone:values.public_phone.trim()||null,
      logo_url:values.logo_url||null,
      updated_at:new Date().toISOString()
    }
    const {error}=await supabase.from('salon_public_settings').upsert(payload,{onConflict:'salon_id'})
    setBusy(false)
    if(error) return alert(error.message)
    onSaved('Website atualizado.')
  }

  if(loading) return <div className="centerInline">A carregar configurações…</div>

  return <form className="formStack siteSettingsForm" onSubmit={submit}>
    <div className="formSection">
      <div className="formSectionHead"><strong>Identidade visual</strong><span>Logótipo mostrado no website.</span></div>
      <div className="imageSettingRow">
        <div className="imageSettingPreview logoPreview">
          {values.logo_url?<img src={values.logo_url} alt="Logótipo do salão"/>:<span>Sem logótipo</span>}
        </div>
        <label className="secondary uploadLabel">
          {uploading?'A carregar…':'Escolher logótipo'}
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e=>void uploadLogo(e.target.files?.[0])}/>
        </label>
      </div>
      <small className="fieldHint">JPG, PNG ou WebP até 5 MB. Idealmente com fundo transparente.</small>
    </div>

    <div className="formSection">
      <div className="formSectionHead"><strong>Contactos públicos</strong><span>Estes dados aparecem no website.</span></div>
      <label>WhatsApp
        <input value={values.whatsapp_phone} onChange={e=>set('whatsapp_phone',e.target.value)} inputMode="tel" placeholder="Ex.: +351 912 345 678"/>
        <small className="fieldHint">Usado pelo botão flutuante de WhatsApp.</small>
      </label>
      <label>Telemóvel / telefone
        <input value={values.public_phone} onChange={e=>set('public_phone',e.target.value)} inputMode="tel" placeholder="Ex.: 253 000 000"/>
        <small className="fieldHint">Mostrado na área de contactos do website.</small>
      </label>
      <label>Instagram
        <input value={values.instagram_url} onChange={e=>set('instagram_url',e.target.value)} inputMode="url" placeholder="instagram.com/deboracruzcabeleireiros"/>
      </label>
      <label>Morada
        <textarea value={values.address} onChange={e=>set('address',e.target.value)} placeholder="Rua, número, código-postal, localidade"/>
      </label>
    </div>
    <button className="primary full stickyFormAction" disabled={busy||uploading}>{busy?'A guardar…':'Guardar alterações'}</button>
  </form>
}

function AppointmentForm({item,presetClient,presetService,presetDate,presetTime,membership,members,services,clients,appointments,manager,onSaved,onVisit,onDelete}:{item?:Appointment;presetClient?:string;presetService?:string;presetDate?:string;presetTime?:string;membership:Member;members:Member[];services:Service[];clients:Client[];appointments:Appointment[];manager:boolean;onSaved:(m:string)=>void;onVisit:(a:Appointment)=>void;onDelete:(a:Appointment)=>void}){
  const [localClients,setLocalClients]=useState<Client[]>(clients)
  useEffect(()=>setLocalClients(clients),[clients])
  const initialClientId=item?.client_id||presetClient||clients[0]?.id||''
  const initialClient=clients.find(c=>c.id===initialClientId)
  const [clientId,setClientId]=useState(initialClientId)
  const [serviceId,setServiceId]=useState(item?.service_id||presetService||initialClient?.preferred_service_id||services[0]?.id||'')
  const [employeeId,setEmployeeId]=useState(item?.employee_id||(manager?(initialClient?.preferred_employee_id||membership.id):membership.id))
  const [date,setDate]=useState(item?localISODate(new Date(item.starts_at)):(presetDate||todayISO()))
  const [time,setTime]=useState(item?`${String(new Date(item.starts_at).getHours()).padStart(2,'0')}:${String(new Date(item.starts_at).getMinutes()).padStart(2,'0')}`:(presetTime||'09:00'))
  const [busy,setBusy]=useState(false)
  const [newClientOpen,setNewClientOpen]=useState(clients.length===0)
  const [creatingClient,setCreatingClient]=useState(false)
  const [newClient,setNewClient]=useState({name:'',phone:'',email:''})

  function changeClient(nextId:string){
    setClientId(nextId)
    if(item) return
    const next=localClients.find(c=>c.id===nextId)
    if(next?.preferred_service_id) setServiceId(next.preferred_service_id)
    if(manager && next?.preferred_employee_id) setEmployeeId(next.preferred_employee_id)
  }

  async function createClient(){
    const name=newClient.name.trim()
    if(!name)return alert('Indica o nome do novo cliente.')
    setCreatingClient(true)
    const payload={
      salon_id:membership.salon_id,
      name,
      phone:newClient.phone.trim()||null,
      email:newClient.email.trim()||null,
      birth_date:null,
      preferred_service_id:null,
      preferred_employee_id:null,
      recurrence_weeks:null,
      dormant_after_weeks:null,
      notes:null
    }
    const {data,error}=await supabase.from('clients').insert(payload).select('*').single()
    setCreatingClient(false)
    if(error)return alert('Não foi possível criar o cliente: '+error.message)
    const created=data as Client
    setLocalClients(current=>[...current,created].sort((a,b)=>a.name.localeCompare(b.name)))
    setClientId(created.id)
    setNewClientOpen(false)
    setNewClient({name:'',phone:'',email:''})
    if(!item){
      if(created.preferred_service_id)setServiceId(created.preferred_service_id)
      if(manager&&created.preferred_employee_id)setEmployeeId(created.preferred_employee_id)
    }
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    if(!clientId)return alert('Seleciona ou cria um cliente.')
    setBusy(true)
    const fd=new FormData(e.currentTarget)
    const service=services.find(x=>x.id===serviceId)
    const start=new Date(`${date}T${time}:00`)
    const end=new Date(start.getTime()+Number(service?.duration_minutes||45)*60000)
    const targetEmployee=manager?employeeId:membership.id
    const weekday=start.getDay()
    const [{data:workingPeriods,error:hoursError},{data:scheduleBlocks,error:blocksError}]=await Promise.all([
      supabase.from('member_working_periods').select('weekday,start_time,end_time').eq('member_id',targetEmployee).order('weekday').order('sort_order'),
      supabase.from('member_schedule_blocks').select('id,starts_at,ends_at,reason').eq('member_id',targetEmployee).lt('starts_at',end.toISOString()).gt('ends_at',start.toISOString()).limit(1)
    ])
    if(hoursError||blocksError){
      setBusy(false)
      return alert((hoursError||blocksError)?.message||'Não foi possível validar o horário.')
    }
    if(workingPeriods?.length){
      const dayPeriods=workingPeriods.filter(p=>p.weekday===weekday)
      if(!dayPeriods.length){
        setBusy(false)
        return alert('Este profissional está de folga neste dia.')
      }
      const endTime=`${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}`
      const insidePeriod=dayPeriods.some(p=>time>=p.start_time.slice(0,5)&&endTime<=p.end_time.slice(0,5))
      if(!insidePeriod){
        setBusy(false)
        const availability=dayPeriods.map(p=>`${p.start_time.slice(0,5)}–${p.end_time.slice(0,5)}`).join(' / ')
        return alert(`Esta marcação fica fora dos períodos disponíveis deste profissional (${availability}).`)
      }
    }
    if(scheduleBlocks?.length){
      setBusy(false)
      return alert(`A agenda deste profissional está bloqueada neste período${scheduleBlocks[0].reason?`: ${scheduleBlocks[0].reason}`:''}.`)
    }
    const conflict=appointments.find(a=>
      a.id!==item?.id &&
      a.employee_id===targetEmployee &&
      a.status!=='cancelled' &&
      new Date(a.starts_at).getTime()<end.getTime() &&
      new Date(a.ends_at).getTime()>start.getTime()
    )
    if(conflict){
      setBusy(false)
      const conflictClient=localClients.find(c=>c.id===conflict.client_id)
      return alert(`Este profissional já tem uma marcação entre ${hhmm(conflict.starts_at)} e ${hhmm(conflict.ends_at)}${conflictClient?` (${conflictClient.name})`:''}.`)
    }

    if(!item){
      const sameDay=appointments
        .filter(a=>a.client_id===clientId&&a.status!=='cancelled'&&localISODate(new Date(a.starts_at))===date)
        .sort((a,b)=>a.starts_at.localeCompare(b.starts_at))
      if(sameDay.length){
        const client=localClients.find(c=>c.id===clientId)
        const details=sameDay.map(a=>{
          const existingService=services.find(s=>s.id===a.service_id)
          return `${hhmm(a.starts_at)}${existingService?` · ${existingService.name}`:''}`
        }).join('\n')
        const confirmed=window.confirm(`${client?.name||'Esta cliente'} já tem ${sameDay.length===1?'uma marcação':'marcações'} neste dia:\n\n${details}\n\nQueres criar uma segunda marcação/serviço no mesmo dia?`)
        if(!confirmed){setBusy(false);return}
      }
    }

    const payload={salon_id:membership.salon_id,client_id:clientId,service_id:serviceId||null,employee_id:targetEmployee,starts_at:start.toISOString(),ends_at:end.toISOString(),status:String(fd.get('status')||'pending'),notes:String(fd.get('notes')||'')||null}
    const q=item?supabase.from('appointments').update(payload).eq('id',item.id):supabase.from('appointments').insert(payload)
    const {error}=await q
    setBusy(false)
    if(error)alert(error.message);else onSaved(item?'Marcação atualizada.':'Marcação criada.')
  }

  return <form className="formStack appointmentForm" onSubmit={submit}>
    <div className="appointmentClientBlock">
      <div className="appointmentFieldHeader"><strong>Cliente</strong>{!item&&<button type="button" className="inlineCreateButton" onClick={()=>setNewClientOpen(v=>!v)}>{newClientOpen?'Cancelar':'+ Novo cliente'}</button>}</div>
      {localClients.length>0&&<select name="client_id" value={clientId} onChange={e=>changeClient(e.target.value)}><option value="">Selecionar cliente…</option>{localClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      {newClientOpen&&<div className="quickClientCreate">
        <div className="quickClientGrid">
          <label>Nome<input value={newClient.name} onChange={e=>setNewClient(v=>({...v,name:e.target.value}))} placeholder="Nome do cliente" autoFocus/></label>
          <label>Telemóvel <span className="optionalLabel">opcional</span><input value={newClient.phone} onChange={e=>setNewClient(v=>({...v,phone:e.target.value}))} inputMode="tel" placeholder="9xx xxx xxx"/></label>
        </div>
        <label>Email <span className="optionalLabel">opcional</span><input value={newClient.email} onChange={e=>setNewClient(v=>({...v,email:e.target.value}))} type="email" placeholder="email@exemplo.pt"/></label>
        <button type="button" className="secondary full" disabled={creatingClient} onClick={()=>void createClient()}>{creatingClient?'A criar…':'Criar cliente e continuar'}</button>
      </div>}
    </div>
    <label>Serviço<select value={serviceId} onChange={e=>setServiceId(e.target.value)}>{services.map(s=><option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min · {money(s.price)}</option>)}</select></label>
    {manager&&<label>Profissional<select name="employee_id" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}>{members.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label>}
    <div className="grid2 appointmentDateTime"><label>Data<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label><label>Hora<input type="time" value={time} onChange={e=>setTime(e.target.value)} required/></label></div>
    {item&&<label>Estado<select name="status" defaultValue={item.status}><option value="pending">Pendente</option><option value="confirmed">Confirmada</option><option value="completed">Concluída</option><option value="no_show">Faltou</option></select></label>}
    <label>Observações <span className="optionalLabel">opcional</span><textarea name="notes" defaultValue={item?.notes||''} placeholder="Ex.: preferência, atraso, detalhe importante…"/></label>
    <button className="primary full appointmentSave" disabled={busy||creatingClient}>{busy?'A guardar…':item?'Guardar alterações':'Guardar marcação'}</button>
    {item&&<div className="modalBottomActions"><button type="button" className="secondary" onClick={()=>onVisit(item)}>Concluir + histórico</button><button type="button" className="dangerButton" onClick={()=>onDelete(item)}>Cancelar marcação</button></div>}
  </form>
}

function ServicesManager({services,onNew,onEdit}:{services:Service[];onNew:()=>void;onEdit:(service:Service)=>void}){
  return <div className="stack serviceManager">
    <button className="primary full" onClick={onNew}>+ Adicionar serviço</button>
    {services.length?services.map(service=><button key={service.id} className="serviceRow" onClick={()=>onEdit(service)}>
      <div><strong>{service.name}</strong><span>{service.duration_minutes} min{service.recurrence_weeks?` · habitual ${service.recurrence_weeks} sem.`:''}</span></div>
      <div className="servicePrice">{money(service.price)} <b>›</b></div>
    </button>):<Empty>Ainda não tens serviços criados.</Empty>}
  </div>
}

function ServiceForm({item,membership,onSaved}:{item?:Service;membership:Member;onSaved:(m:string)=>void}){
  const [busy,setBusy]=useState(false)
  const [uploading,setUploading]=useState(false)
  const [imageUrl,setImageUrl]=useState(item?.image_url||'')

  async function uploadImage(file?:File){
    if(!file) return
    setUploading(true)
    try{
      const url=await uploadSalonPublicImage(membership.salon_id,file,'services')
      setImageUrl(url)
    }catch(err:any){alert(err?.message||'Não foi possível carregar a imagem.')}
    finally{setUploading(false)}
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true)
    const fd=new FormData(e.currentTarget)
    const payload={
      salon_id:membership.salon_id,
      name:String(fd.get('name')||'').trim(),
      duration_minutes:Number(fd.get('duration_minutes')||45),
      price:Number(fd.get('price')||0),
      recurrence_weeks:Number(fd.get('recurrence_weeks')||0)||null,
      image_url:imageUrl||null,
      active:true
    }
    if(!payload.name){setBusy(false);return alert('Indica o nome do serviço.')}
    const q=item?supabase.from('services').update(payload).eq('id',item.id):supabase.from('services').insert(payload)
    const {error}=await q;setBusy(false)
    if(error)return alert(error.message)
    onSaved(item?'Serviço atualizado.':'Serviço criado.')
  }
  async function archive(){
    if(!item || !window.confirm(`Desativar "${item.name}"? As marcações antigas mantêm-se.`)) return
    setBusy(true)
    const {error}=await supabase.from('services').update({active:false}).eq('id',item.id)
    setBusy(false)
    if(error)return alert(error.message)
    onSaved('Serviço desativado.')
  }
  return <form className="formStack serviceForm" onSubmit={submit}>
    <section className="formSection">
      <div className="formSectionHead"><div><strong>Imagem do serviço</strong><span>Usada no cartão do website</span></div></div>
      <div className="serviceImageEditor">
        <div className="serviceImagePreview">{imageUrl?<img src={imageUrl} alt={item?.name||'Serviço'}/>:<span>Sem imagem personalizada</span>}</div>
        <label className="secondary uploadLabel">
          {uploading?'A carregar…':'Escolher imagem'}
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e=>void uploadImage(e.target.files?.[0])}/>
        </label>
      </div>
      <small className="fieldHint">JPG, PNG ou WebP até 5 MB. Formato horizontal funciona melhor.</small>
    </section>

    <section className="formSection">
      <div className="formSectionHead"><div><strong>Serviço</strong><span>Informação usada nas marcações</span></div></div>
      <label>Nome<input name="name" required autoFocus defaultValue={item?.name||''} placeholder="Ex.: Corte"/></label>
      <div className="serviceFormGrid">
        <label>Preço (€)<input name="price" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={item?.price||0}/></label>
        <label>Duração<input name="duration_minutes" type="number" inputMode="numeric" min="5" step="5" defaultValue={item?.duration_minutes||45}/><small className="muted">minutos</small></label>
      </div>
      <label>Recorrência habitual <span className="optionalLabel">opcional</span><div className="inlineUnit"><input name="recurrence_weeks" type="number" inputMode="numeric" min="1" max="52" defaultValue={item?.recurrence_weeks||''} placeholder="Ex.: 5"/><span>semanas</span></div></label>
      <p className="formHint">Ao selecionar este serviço numa marcação, a agenda reserva automaticamente esta duração para o profissional.</p>
    </section>
    <div className="stickyFormAction"><button className="primary full" disabled={busy||uploading}>{busy?'A guardar…':item?'Guardar alterações':'Criar serviço'}</button></div>
    {item&&<button type="button" className="dangerButton full" disabled={busy||uploading} onClick={()=>void archive()}>Desativar serviço</button>}
  </form>
}

function ClientForm({item,prefill,membership,services,members,onSaved}:{item?:Client;prefill?:{name?:string;phone?:string};membership:Member;services:Service[];members:Member[];onSaved:(m:string)=>void}){
  const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true)
    const fd=new FormData(e.currentTarget)
    const payload={
      salon_id:membership.salon_id,
      name:String(fd.get('name')),
      phone:String(fd.get('phone')||'')||null,
      email:String(fd.get('email')||'')||null,
      birth_date:String(fd.get('birth_date')||'')||null,
      preferred_service_id:String(fd.get('preferred_service_id')||'')||null,
      preferred_employee_id:String(fd.get('preferred_employee_id')||'')||null,
      recurrence_weeks:Number(fd.get('recurrence_weeks')||0)||null,
      dormant_after_weeks:Number(fd.get('dormant_after_weeks')||0)||null,
      notes:String(fd.get('notes')||'')||null
    }
    const q=item?supabase.from('clients').update(payload).eq('id',item.id):supabase.from('clients').insert(payload)
    const {error}=await q;setBusy(false)
    if(error)alert(error.message);else onSaved(item?'Cliente atualizado.':'Cliente criado.')
  }
  return <form className="formStack clientEditForm" onSubmit={submit}>
    <section className="formSection">
      <div className="formSectionHead"><div><strong>Dados pessoais</strong><span>Contacto e aniversário</span></div></div>
      <label className="nameField">Nome<input name="name" required autoComplete="name" defaultValue={item?.name||prefill?.name||''} placeholder="Nome da cliente"/></label>
      <div className="clientContactFields">
        <label>Telemóvel<input name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={item?.phone||prefill?.phone||''} placeholder="9xx xxx xxx"/></label>
        <label>Email <span className="optionalLabel">opcional</span><input name="email" type="email" autoComplete="email" defaultValue={item?.email||''} placeholder="email@exemplo.pt"/></label>
      </div>
      <label>Aniversário <span className="optionalLabel">opcional</span><input name="birth_date" type="date" defaultValue={item?.birth_date||''}/></label>
    </section>

    <section className="formSection">
      <div className="formSectionHead"><div><strong>Preferências</strong><span>Usadas para acelerar novas marcações</span></div></div>
      <label>Profissional habitual<select name="preferred_employee_id" defaultValue={item?.preferred_employee_id||''}><option value="">Sem profissional definido</option>{members.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label>
      <div className="preferenceFields">
        <label>Serviço habitual<select name="preferred_service_id" defaultValue={item?.preferred_service_id||services[0]?.id||''}><option value="">Sem preferência</option>{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Repetir a cada <span className="optionalLabel">semanas</span><input name="recurrence_weeks" type="number" inputMode="numeric" min="1" max="52" defaultValue={item?.recurrence_weeks||''} placeholder="Ex.: 5"/></label>
      </div>
      <label>Considerar adormecido após <span className="optionalLabel">opcional</span><div className="inlineUnit"><input name="dormant_after_weeks" type="number" inputMode="numeric" min="1" max="104" defaultValue={item?.dormant_after_weeks||''} placeholder="Usar regra geral"/><span>semanas</span></div></label>
      <p className="formHint">Estas preferências ficam pré-selecionadas quando crias uma nova marcação. O prazo de cliente adormecido pode substituir a regra geral do negócio.</p>
    </section>

    <section className="formSection">
      <div className="formSectionHead"><div><strong>Notas</strong><span>Informação útil para a equipa</span></div></div>
      <label className="srOnlyLabel">Observações<textarea name="notes" defaultValue={item?.notes||''} placeholder="Ex.: preferências, alergias, detalhes importantes…"/></label>
    </section>

    <div className="stickyFormAction"><button className="primary full" disabled={busy}>{busy?'A guardar…':item?'Guardar alterações':'Criar cliente'}</button></div>
  </form>
}

function ClientDetail({client,appointments,visits,services,memberBy,onEdit,onBook,onVisit}:{client:Client;appointments:Appointment[];visits:Visit[];services:Service[];memberBy:(id:string)=>Member|undefined;onEdit:()=>void;onBook:()=>void;onVisit:()=>void}){
  const history=visits.filter(v=>v.client_id===client.id).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on))
  const last=history[0]; const service=services.find(s=>s.id===client.preferred_service_id); const due=client.recurrence_weeks||service?.recurrence_weeks; const passed=last?weeksBetween(last.occurred_on):null
  const nextAppointment=appointments.filter(a=>a.client_id===client.id && !['cancelled','completed','no_show'].includes(a.status) && new Date(a.starts_at).getTime()>=Date.now()).sort((a,b)=>a.starts_at.localeCompare(b.starts_at))[0]
  const nextService=nextAppointment?services.find(s=>s.id===nextAppointment.service_id):undefined
  const reminder=nextAppointment?appointmentReminderMessage(client.name,nextService?.name||'serviço',hhmm(nextAppointment.starts_at)):`Olá ${client.name},`
  return <div><div className="clientHero"><div className="bigAvatar">{initials(client.name)}</div><div><h3>{client.name}</h3><span>{client.phone||'Sem telefone'}</span></div></div>{client.phone&&<><div className="contactGrid"><button className="secondary" onClick={()=>whatsApp(client.phone,reminder)}>WhatsApp</button><button className="secondary" onClick={()=>smsMessage(client.phone,reminder)}>SMS</button></div>{nextAppointment&&<p className="muted small" style={{marginTop:-4}}>Lembrete: {nextService?.name||'Serviço'} · {hhmm(nextAppointment.starts_at)}</p>}</>}<div className="quickActions"><button className="secondary" onClick={onBook}>+ Marcar</button><button className="secondary" onClick={onEdit}>Editar</button></div>{client.birth_date&&<InfoCard label="Aniversário">{new Intl.DateTimeFormat(locale,{day:'2-digit',month:'long'}).format(new Date(`${client.birth_date}T12:00:00`))}</InfoCard>}{client.preferred_employee_id&&<InfoCard label="Profissional habitual">{memberBy(client.preferred_employee_id)?.display_name||'Profissional'}</InfoCard>}{client.notes&&<InfoCard label="Observações">{client.notes}</InfoCard>}{last&&due&&<InfoCard label="Recorrência">{passed} semanas desde a última visita · habitual {due}</InfoCard>}<div className="sectionHead"><h3>Histórico</h3><button className="textButton" onClick={onVisit}>+ Visita</button></div>{history.length?history.map(v=><div className="historyItem" key={v.id}><div><strong>{new Intl.DateTimeFormat(locale).format(new Date(`${v.occurred_on}T12:00:00`))} · {v.service_label||'Serviço'}</strong>{v.color_formula&&<span><b>Cor/fórmula:</b> {v.color_formula}</span>}{v.treatment_products&&<span><b>Tratamento/produtos:</b> {v.treatment_products}</span>}{v.notes&&<span>{v.notes}</span>}<small>{memberBy(v.employee_id)?.display_name}</small></div><b>{money(v.amount_paid)}</b></div>):<Empty>Sem histórico ainda.</Empty>}</div>
}

function VisitForm({client,appointment,membership,serviceBy,onSaved}:{client:Client;appointment?:Appointment;membership:Member;serviceBy:(id:string|null)=>Service|undefined;onSaved:(m:string)=>void}){
  const service=appointment?serviceBy(appointment.service_id):undefined
  const [defaultCommission,setDefaultCommission]=useState(0)
  useEffect(()=>{supabase.from('salon_business_settings').select('commission_default_percent').eq('salon_id',membership.salon_id).maybeSingle().then(({data})=>setDefaultCommission(Number(data?.commission_default_percent||0)))},[membership.salon_id])
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    const fd=new FormData(e.currentTarget)
    const amount=Number(fd.get('amount_paid')||0)
    const employeeId=appointment?.employee_id||membership.id
    const payload={salon_id:membership.salon_id,client_id:client.id,appointment_id:appointment?.id||null,employee_id:employeeId,service_id:appointment?.service_id||null,occurred_on:String(fd.get('occurred_on')),service_label:String(fd.get('service_label')||'')||null,color_formula:String(fd.get('color_formula')||'')||null,treatment_products:String(fd.get('treatment_products')||'')||null,notes:String(fd.get('notes')||'')||null,amount_paid:amount}
    const {error}=await supabase.from('visits').insert(payload)
    if(error)return alert(error.message)
    if(amount>0){
      const commission=Number(fd.get('commission_percent')||0)
      const {data:sale,error:saleError}=await supabase.from('sales').insert({
        salon_id:membership.salon_id,
        client_id:client.id,
        appointment_id:appointment?.id||null,
        employee_id:employeeId,
        occurred_at:new Date(`${payload.occurred_on}T12:00:00`).toISOString(),
        subtotal:amount,
        discount_amount:0,
        total_amount:amount,
        payment_method:String(fd.get('payment_method')||'other'),
        commission_percent:commission,
        commission_amount:Math.round(amount*commission)/100,
        notes:payload.notes
      }).select('id').single()
      if(saleError)return alert('A visita foi guardada, mas a venda não: '+saleError.message)
      await supabase.from('sale_items').insert({sale_id:sale.id,salon_id:membership.salon_id,item_type:'service',ref_id:appointment?.service_id||null,label:payload.service_label||service?.name||'Serviço',quantity:1,unit_price:amount,total_amount:amount})
    }
    if(appointment)await supabase.from('appointments').update({status:'completed'}).eq('id',appointment.id)
    onSaved('Visita e venda guardadas.')
  }
  return <form className="formStack visitForm" onSubmit={submit}>
    <label>Data<input name="occurred_on" type="date" defaultValue={appointment?localISODate(new Date(appointment.starts_at)):todayISO()} required/></label>
    <label>Serviço<input name="service_label" defaultValue={service?.name||''} placeholder="Ex.: Coloração + corte"/></label>
    <label>Cor / fórmula técnica<textarea name="color_formula" placeholder="Ex.: 6/0 30g + 6/7 20g · Oxidante 6% 50g"/></label>
    <label>Tratamentos / produtos<input name="treatment_products" placeholder="Ex.: Máscara Repair"/></label>
    <label>Observações<textarea name="notes"/></label>
    <label>Valor pago (€)<input name="amount_paid" type="number" min="0" step="0.01" defaultValue={service?.price||''}/></label>
    <div className="grid2"><label>Pagamento<select name="payment_method"><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="mbway">MB Way</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label><label>Comissão (%)<input name="commission_percent" type="number" min="0" max="100" step="0.1" defaultValue={defaultCommission}/></label></div>
    <button className="primary full">Guardar visita + venda</button>
  </form>
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

function StaffForm({onSaved}:{onSaved:(m:string)=>void}){
  const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    setBusy(true)
    const fd=new FormData(e.currentTarget)
    const name=String(fd.get('name')||'').trim()
    const {error}=await supabase.rpc('create_staff_without_login',{p_display_name:name})
    setBusy(false)
    if(error){alert(`Não foi possível adicionar o profissional: ${error.message}`);return}
    onSaved(`${name} foi adicionado à equipa e já pode receber marcações.`)
  }
  return <form className="formStack" onSubmit={submit}><label>Nome do profissional<input name="name" required autoFocus placeholder="Ex.: Carla" /></label><button className="primary full" disabled={busy}>{busy?'A adicionar…':'Adicionar profissional'}</button><p className="muted small">Não é criado qualquer login. Este profissional aparece na agenda e pode ser associado às clientes e às marcações.</p></form>
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

function BookingRequestCard({request,client,onStatus,onSchedule,onClient}:{request:BookingRequest;client?:Client;onStatus:(id:string,status:'contacted'|'booked'|'closed')=>void;onSchedule:()=>void;onClient:()=>void}){
  const date=new Intl.DateTimeFormat(locale,{weekday:'short',day:'2-digit',month:'short'}).format(new Date(`${request.preferred_date}T12:00:00`))
  const period=request.preferred_period==='morning'?'Manhã':request.preferred_period==='afternoon'?'Tarde':'Sem preferência'
  const periodText=request.preferred_period==='no_preference'?'sem preferência de horário':`durante a ${period.toLowerCase()}`
  const text=`Olá ${firstName(request.name)}, recebemos o seu pedido de marcação para ${request.service_name} no dia ${date}, ${periodText}. Vamos confirmar consigo a disponibilidade. Obrigado`
  return <article className="card bookingRequestCard"><div className="cardRow"><span className="timeTag">{period}</span><div className="grow"><div className="bookingRequestTitle"><strong>{request.name}</strong><span className={`tag ${client?'ok':'warn'}`}>{client?'Cliente existente':'Novo cliente'}</span></div><span>{request.service_name} · {date} · {request.phone}</span>{request.notes&&<small>{request.notes}</small>}<div className="miniActions">{client&&<button className="mini" onClick={onClient}>Ficha</button>}<button className="mini primaryMini" onClick={onSchedule}>Criar marcação</button><button className="mini dark" onClick={()=>{whatsApp(request.phone,text);onStatus(request.id,'contacted')}}>WhatsApp</button><button className="mini" onClick={()=>{smsMessage(request.phone,text);onStatus(request.id,'contacted')}}>SMS</button><button className="mini" onClick={()=>onStatus(request.id,'closed')}>Fechar</button></div></div></div></article>
}

function BirthdayCard({client,date,daysUntil,onClient}:{client:Client;date:Date;daysUntil:number;onClient:()=>void}){
  const text=birthdayMessage(client.name)
  const label=daysUntil===0?'Hoje 🎂':new Intl.DateTimeFormat(locale,{weekday:'short',day:'2-digit',month:'short'}).format(date)
  return <article className="card birthdayCard"><div className="cardRow"><span className="timeTag">{label}</span><div className="grow"><strong>{client.name}</strong><span>Aniversário</span><div className="miniActions"><button className="mini" onClick={onClient}>Ficha</button>{client.phone?<><button className="mini dark" onClick={()=>whatsApp(client.phone,text)}>WhatsApp</button><button className="mini" onClick={()=>smsMessage(client.phone,text)}>SMS</button></>:<span className="tag warn">Sem telemóvel</span>}</div></div></div></article>
}

function TomorrowConfirmationCard({a,c,s,m,onClient}:{a:Appointment;c?:Client;s?:Service;m?:Member;onClient:()=>void}){
  const reminder=c?appointmentReminderMessage(c.name,s?.name||'serviço',hhmm(a.starts_at)):''
  return <article className="card confirmationCard"><div className="cardRow"><span className="timeTag">{hhmm(a.starts_at)}</span><div className="grow"><strong>{c?.name||'Cliente'}</strong><span>{s?.name||'Serviço'} · {m?.display_name||''}</span><div className="miniActions"><button className="mini" onClick={onClient}>Ficha</button>{c?.phone?<><button className="mini dark" onClick={()=>whatsApp(c.phone,reminder)}>WhatsApp</button><button className="mini" onClick={()=>smsMessage(c.phone,reminder)}>SMS</button></>:<span className="tag warn">Sem telemóvel</span>}</div></div></div></article>
}

function AppointmentCard({a,c,s,m,salonName,onClient}:{a:Appointment;c?:Client;s?:Service;m?:Member;salonName:string;onClient:()=>void}){const reminder=c?appointmentReminderMessage(c.name,s?.name||'serviço',hhmm(a.starts_at)):'';return <article className="card"><div className="cardRow"><span className="timeTag">{hhmm(a.starts_at)}</span><div className="grow"><strong>{c?.name||'Cliente'}</strong><span>{s?.name||'Serviço'} · {m?.display_name||''}</span><div className="miniActions"><button className="mini" onClick={onClient}>Ficha</button>{c?.phone&&<><button className="mini dark" onClick={()=>whatsApp(c.phone,reminder)}>WhatsApp</button><button className="mini" onClick={()=>smsMessage(c.phone,reminder)}>SMS</button></>}</div></div></div></article>}
function RetentionCard({r,onBook}:{r:{client:Client;last:Visit;due:number;passed:number;late:number};onBook:()=>void}){const text=`Olá ${firstName(r.client.name)} 😊 Já passaram cerca de ${r.passed} semanas desde a tua última visita. Queres que te reserve um horário?`;return <article className="card"><strong>{r.client.name}</strong><span>Última visita: {new Intl.DateTimeFormat(locale).format(new Date(`${r.last.occurred_on}T12:00:00`))} · habitual {r.due} semanas</span><div className="tagRow"><span className={`tag ${r.late>=2?'danger':'warn'}`}>{r.late===0?'Está na altura':`${r.late} sem. em atraso`}</span></div><div className="miniActions"><button className="mini dark" onClick={()=>whatsApp(r.client.phone,text)}>WhatsApp</button><button className="mini" onClick={()=>smsMessage(r.client.phone,text)}>SMS</button><button className="mini" onClick={onBook}>Marcar</button></div></article>}
function ProductCard({p,actions}:{p:Product;actions?:ReactNode}){const low=Number(p.current_stock)<=Number(p.min_stock);return <article className="card"><strong>{p.name}</strong><span>{p.brand||''}{p.barcode?` · ${p.barcode}`:''}</span><div className="tagRow"><span className={`tag ${low?'danger':'ok'}`}>Stock: {p.current_stock} {p.unit}</span><span className="tag">Mín.: {p.min_stock}</span></div>{actions&&<div className="miniActions">{actions}</div>}</article>}
function Kpi({label,value,sub}:{label:string;value:number;sub:string}){return <article className="kpi"><span>{label}</span><strong>{value}</strong><small>{sub}</small></article>}
function Section({title,children}:{title:string;children:ReactNode}){return <section className="dashboardSection"><div className="sectionHead"><h2>{title}</h2></div><div className="stack">{children}</div></section>}
function Empty({children}:{children:ReactNode}){return <div className="empty">{children}</div>}
function InfoCard({label,children}:{label:string;children:ReactNode}){return <div className="infoCard"><span>{label}</span><strong>{children}</strong></div>}

function modalTitle(m:Exclude<Modal,null>){return m.kind==='appointment'?(m.item?'Editar marcação':'Nova marcação'):m.kind==='client'?(m.item?'Editar cliente':'Novo cliente'):m.kind==='clientDetail'?m.client.name:m.kind==='visit'?'Registar visita':m.kind==='product'?(m.item?'Editar produto':'Novo produto'):m.kind==='scanner'?'Ler código de barras':m.kind==='staff'?'Adicionar profissional':m.kind==='services'?'Serviços':m.kind==='service'?(m.item?'Editar serviço':'Novo serviço'):m.kind==='siteSettings'?'Website e contactos':m.kind==='businessHub'?'Gestão do negócio':m.kind==='dashboardCustomize'?'Personalizar página inicial':'Convidar colaborador'}
function titleFor(v:View){return ({today:'Hoje',agenda:'Agenda',clients:'Clientes',alerts:'Alertas',stock:'Stock',more:'Conta'} as const)[v]}
function navLabel(v:View){return ({today:'Hoje',agenda:'Agenda',clients:'Clientes',alerts:'Alertas',stock:'Stock',more:'Mais'} as const)[v]}
function NavGlyph({view}:{view:View}){
  if(view==='today') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.6 12 3.8l8.5 6.8v9.1a.8.8 0 0 1-.8.8H4.3a.8.8 0 0 1-.8-.8v-9.1Z"/><path d="M9 20.5v-6.2h6v6.2"/></svg>
  if(view==='agenda') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M7.5 3.5v4M16.5 3.5v4M3.5 9.5h17"/></svg>
  if(view==='clients') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.2" r="3.2"/><path d="M3.8 19.5c.5-4 2.3-6 5.2-6s4.7 2 5.2 6M15.2 10.6a3 3 0 1 0 0-5.7M16 13.8c2.5.3 3.9 2.2 4.2 5.7"/></svg>
  if(view==='alerts') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.7 9.7a5.3 5.3 0 1 1 10.6 0c0 5.7 2.3 6.5 2.3 6.5H4.4s2.3-.8 2.3-6.5Z"/><path d="M9.7 19.1c.5.8 1.2 1.2 2.3 1.2s1.8-.4 2.3-1.2"/></svg>
  if(view==='stock') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.1 12 3l8 4.1-8 4.1L4 7.1Z"/><path d="M4 7.1v9.8L12 21l8-4.1V7.1M12 11.2V21"/></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
}
function navIcon(v:View){return ({today:'⌂',agenda:'□',clients:'♙',alerts:'!',stock:'▤',more:'•••'} as const)[v]}
function initials(name:string){return name.split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()).join('')||'S'}
function roleLabel(role:Role){return role==='owner'?'Proprietário':role==='manager'?'Gerente':'Colaborador'}
