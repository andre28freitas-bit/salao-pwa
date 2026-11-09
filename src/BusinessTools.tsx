import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

type Member={id:string;salon_id:string;display_name:string;role:string;active:boolean}
type Client={id:string;salon_id:string;name:string;phone:string|null;preferred_service_id:string|null;dormant_after_weeks?:number|null}
type Service={id:string;name:string;price:number}
type Appointment={id:string;client_id:string;employee_id:string;starts_at:string;status:string}
type Visit={id:string;client_id:string;employee_id:string;occurred_on:string;amount_paid:number}
type Settings={
  salon_id:string
  booking_mode:'request'|'direct'
  deposit_type:'fixed'|'percent'|null
  deposit_value:number
  dormant_after_weeks:number
  loyalty_enabled:boolean
  loyalty_visits_required:number
  loyalty_reward_text:string
  commission_default_percent:number
}
type WorkingHour={id:string;member_id:string;weekday:number;enabled:boolean;start_time:string;end_time:string}
type ScheduleBlock={id:string;member_id:string;starts_at:string;ends_at:string;reason:string|null}
type Redemption={id:string;client_id:string;visits_required_snapshot:number;reward_text:string;redeemed_at:string}
type Sale={id:string;client_id:string|null;employee_id:string;occurred_at:string;total_amount:number;payment_method:string;commission_percent:number;commission_amount:number;notes:string|null}

const weekdays=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado']
const euro=(n:number)=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(Number(n||0))
const localDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const weeksSince=(iso:string)=>Math.max(0,Math.floor((Date.now()-new Date(`${iso}T12:00:00`).getTime())/(7*86400000)))
const monthKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`

export default function BusinessHub({
  membership,members,clients,services,appointments,visits,onChanged
}:{
  membership:Member
  members:Member[]
  clients:Client[]
  services:Service[]
  appointments:Appointment[]
  visits:Visit[]
  onChanged:()=>void|Promise<void>
}){
  const [tab,setTab]=useState<'dashboard'|'booking'|'team'|'dormant'|'loyalty'|'sales'>('dashboard')
  const [loading,setLoading]=useState(true)
  const [settings,setSettings]=useState<Settings|null>(null)
  const [hours,setHours]=useState<WorkingHour[]>([])
  const [blocks,setBlocks]=useState<ScheduleBlock[]>([])
  const [redemptions,setRedemptions]=useState<Redemption[]>([])
  const [sales,setSales]=useState<Sale[]>([])
  const [selectedMember,setSelectedMember]=useState(members[0]?.id||'')
  const [saved,setSaved]=useState('')

  useEffect(()=>{void load()},[membership.salon_id])

  async function load(){
    setLoading(true)
    const sid=membership.salon_id
    const [st,h,b,r,s]=await Promise.all([
      supabase.from('salon_business_settings').select('*').eq('salon_id',sid).maybeSingle(),
      supabase.from('member_working_hours').select('*').eq('salon_id',sid).order('weekday'),
      supabase.from('member_schedule_blocks').select('*').eq('salon_id',sid).gte('ends_at',new Date().toISOString()).order('starts_at'),
      supabase.from('loyalty_redemptions').select('*').eq('salon_id',sid).order('redeemed_at',{ascending:false}),
      supabase.from('sales').select('*').eq('salon_id',sid).order('occurred_at',{ascending:false}).limit(100)
    ])
    for(const q of [st,h,b,r,s]) if(q.error) console.warn(q.error.message)
    if(st.data) setSettings(st.data as Settings)
    setHours((h.data||[]) as WorkingHour[])
    setBlocks((b.data||[]) as ScheduleBlock[])
    setRedemptions((r.data||[]) as Redemption[])
    setSales((s.data||[]) as Sale[])
    setLoading(false)
  }

  function flash(message:string){setSaved(message);window.setTimeout(()=>setSaved(''),2200)}

  if(loading||!settings) return <div className="centerInline">A carregar gestão do negócio…</div>

  return <div className="businessHub">
    <div className="businessTabs">
      <button className={tab==='dashboard'?'active':''} onClick={()=>setTab('dashboard')}>Dashboard</button>
      <button className={tab==='booking'?'active':''} onClick={()=>setTab('booking')}>Marcações</button>
      <button className={tab==='team'?'active':''} onClick={()=>setTab('team')}>Equipa</button>
      <button className={tab==='dormant'?'active':''} onClick={()=>setTab('dormant')}>Adormecidos</button>
      <button className={tab==='loyalty'?'active':''} onClick={()=>setTab('loyalty')}>Fidelização</button>
      <button className={tab==='sales'?'active':''} onClick={()=>setTab('sales')}>Vendas</button>
    </div>
    {saved&&<div className="businessSaved">{saved}</div>}
    {tab==='dashboard'&&<Dashboard clients={clients} appointments={appointments} visits={visits} sales={sales} settings={settings}/>}
    {tab==='booking'&&<BookingSettings settings={settings} setSettings={setSettings} onSaved={async()=>{flash('Configuração guardada.');await onChanged()}}/>}
    {tab==='team'&&<TeamSchedule membership={membership} members={members} selectedMember={selectedMember} setSelectedMember={setSelectedMember} hours={hours} blocks={blocks} reload={async()=>{await load();flash('Horário atualizado.')}}/>}
    {tab==='dormant'&&<DormantClients clients={clients} services={services} visits={visits} settings={settings} onSettings={async next=>{setSettings(next);await onChanged();flash('Prazo atualizado.')}}/>}
    {tab==='loyalty'&&<Loyalty membership={membership} clients={clients} visits={visits} settings={settings} setSettings={setSettings} redemptions={redemptions} reload={async()=>{await load();await onChanged();flash('Fidelização atualizada.')}}/>}
    {tab==='sales'&&<Sales membership={membership} members={members} clients={clients} settings={settings} sales={sales} reload={async()=>{await load();await onChanged();flash('Venda registada.')}}/>}
  </div>
}

function Dashboard({clients,appointments,visits,sales,settings}:{clients:Client[];appointments:Appointment[];visits:Visit[];sales:Sale[];settings:Settings}){
  const month=monthKey()
  const monthVisits=visits.filter(v=>v.occurred_on.startsWith(month))
  const monthSales=sales.filter(s=>localDate(new Date(s.occurred_at)).startsWith(month))
  const revenue=monthSales.length?monthSales.reduce((n,s)=>n+Number(s.total_amount),0):monthVisits.reduce((n,v)=>n+Number(v.amount_paid),0)
  const monthAppointments=appointments.filter(a=>localDate(new Date(a.starts_at)).startsWith(month)&&a.status!=='cancelled')
  const ticket=(monthSales.length?revenue/monthSales.length:monthVisits.length?revenue/monthVisits.length:0)
  const clientCounts=new Map<string,number>()
  visits.forEach(v=>clientCounts.set(v.client_id,(clientCounts.get(v.client_id)||0)+1))
  const recurring=[...clientCounts.values()].filter(n=>n>1).length
  const dormant=clients.filter(c=>{
    const last=visits.filter(v=>v.client_id===c.id).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on))[0]
    return last&&weeksSince(last.occurred_on)>=Number(c.dormant_after_weeks||settings.dormant_after_weeks)
  }).length
  return <div className="businessPanel">
    <div className="businessIntro"><div><span>Este mês</span><h3>Visão do negócio</h3></div><small>Atualizado com marcações, visitas e vendas registadas.</small></div>
    <div className="businessKpis">
      <Metric label="Faturação" value={euro(revenue)} />
      <Metric label="Marcações" value={String(monthAppointments.length)} />
      <Metric label="Ticket médio" value={euro(ticket)} />
      <Metric label="Clientes recorrentes" value={String(recurring)} />
      <Metric label="Adormecidos" value={String(dormant)} />
      <Metric label="Vendas registadas" value={String(monthSales.length)} />
    </div>
  </div>
}

function Metric({label,value}:{label:string;value:string}){return <div className="businessMetric"><span>{label}</span><strong>{value}</strong></div>}

function BookingSettings({settings,setSettings,onSaved}:{settings:Settings;setSettings:(s:Settings)=>void;onSaved:()=>void|Promise<void>}){
  const [busy,setBusy]=useState(false)
  async function save(e:FormEvent){
    e.preventDefault()
    if(settings.booking_mode==='direct'&&(!settings.deposit_type||Number(settings.deposit_value)<=0)) return alert('Na marcação direta é obrigatório definir uma caução.')
    setBusy(true)
    const {error}=await supabase.from('salon_business_settings').update({
      booking_mode:settings.booking_mode,
      deposit_type:settings.booking_mode==='direct'?settings.deposit_type:null,
      deposit_value:settings.booking_mode==='direct'?Number(settings.deposit_value):0,
      updated_at:new Date().toISOString()
    }).eq('salon_id',settings.salon_id)
    setBusy(false)
    if(error)return alert(error.message)
    await onSaved()
  }
  return <form className="businessPanel formStack" onSubmit={save}>
    <div className="businessIntro"><div><span>Fluxo público</span><h3>Como quer receber marcações?</h3></div></div>
    <div className="choiceCards">
      <label className={settings.booking_mode==='request'?'selected':''}><input type="radio" checked={settings.booking_mode==='request'} onChange={()=>setSettings({...settings,booking_mode:'request'})}/><strong>Pedido de marcação</strong><span>O cliente indica a preferência e o negócio confirma depois.</span></label>
      <label className={settings.booking_mode==='direct'?'selected':''}><input type="radio" checked={settings.booking_mode==='direct'} onChange={()=>setSettings({...settings,booking_mode:'direct',deposit_type:settings.deposit_type||'fixed',deposit_value:settings.deposit_value||10})}/><strong>Marcação direta + caução</strong><span>O horário só fica confirmado após pagamento da caução.</span></label>
    </div>
    {settings.booking_mode==='direct'&&<div className="formSection">
      <div className="grid2">
        <label>Tipo de caução<select value={settings.deposit_type||'fixed'} onChange={e=>setSettings({...settings,deposit_type:e.target.value as 'fixed'|'percent'})}><option value="fixed">Valor fixo (€)</option><option value="percent">Percentagem (%)</option></select></label>
        <label>Valor<input type="number" min="0.01" step="0.01" value={settings.deposit_value} onChange={e=>setSettings({...settings,deposit_value:Number(e.target.value)})}/></label>
      </div>
      <p className="formHint">A estrutura fica pronta no BO. A marcação direta só deve ser ativada no website quando estiver ligado o provedor de pagamentos.</p>
    </div>}
    <button className="primary full" disabled={busy}>{busy?'A guardar…':'Guardar configuração'}</button>
  </form>
}

function TeamSchedule({membership,members,selectedMember,setSelectedMember,hours,blocks,reload}:{membership:Member;members:Member[];selectedMember:string;setSelectedMember:(s:string)=>void;hours:WorkingHour[];blocks:ScheduleBlock[];reload:()=>void|Promise<void>}){
  const memberHours=hours.filter(h=>h.member_id===selectedMember)
  const [draft,setDraft]=useState<Record<number,{enabled:boolean;start:string;end:string}>>({})
  useEffect(()=>{
    const next:Record<number,{enabled:boolean;start:string;end:string}>={}
    for(let d=0;d<7;d++){const row=memberHours.find(h=>h.weekday===d);next[d]={enabled:row?.enabled??(d!==0),start:(row?.start_time||'09:00').slice(0,5),end:(row?.end_time||'18:00').slice(0,5)}}
    setDraft(next)
  },[selectedMember,hours.length])

  async function saveWeek(){
    if(!selectedMember)return
    const rows=Object.entries(draft).map(([weekday,x])=>({salon_id:membership.salon_id,member_id:selectedMember,weekday:Number(weekday),enabled:x.enabled,start_time:x.start,end_time:x.end,updated_at:new Date().toISOString()}))
    const {error}=await supabase.from('member_working_hours').upsert(rows,{onConflict:'member_id,weekday'})
    if(error)return alert(error.message)
    await reload()
  }
  async function block(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); const fd=new FormData(e.currentTarget); const date=String(fd.get('date')); const start=String(fd.get('start')); const end=String(fd.get('end'))
    const {error}=await supabase.from('member_schedule_blocks').insert({salon_id:membership.salon_id,member_id:selectedMember,starts_at:new Date(`${date}T${start}:00`).toISOString(),ends_at:new Date(`${date}T${end}:00`).toISOString(),reason:String(fd.get('reason')||'')||null})
    if(error)return alert(error.message)
    e.currentTarget.reset(); await reload()
  }
  async function removeBlock(id:string){const {error}=await supabase.from('member_schedule_blocks').delete().eq('id',id);if(error)return alert(error.message);await reload()}

  return <div className="businessPanel">
    <div className="businessIntro"><div><span>Equipa</span><h3>Horário e bloqueios</h3></div><small>Define o horário normal e bloqueia períodos quando necessário.</small></div>
    <label>Profissional<select value={selectedMember} onChange={e=>setSelectedMember(e.target.value)}>{members.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label>
    <div className="weekSchedule">
      {Object.entries(draft).map(([day,row])=><div className="weekRow" key={day}>
        <label className="dayToggle"><input type="checkbox" checked={row.enabled} onChange={e=>setDraft({...draft,[Number(day)]:{...row,enabled:e.target.checked}})}/><strong>{weekdays[Number(day)]}</strong></label>
        {row.enabled?<div className="timePair"><input type="time" value={row.start} onChange={e=>setDraft({...draft,[Number(day)]:{...row,start:e.target.value}})}/><span>—</span><input type="time" value={row.end} onChange={e=>setDraft({...draft,[Number(day)]:{...row,end:e.target.value}})}/></div>:<span className="muted small">Folga</span>}
      </div>)}
    </div>
    <button className="primary full" onClick={()=>void saveWeek()}>Guardar horário</button>
    <div className="businessSubhead"><h4>Bloquear agenda</h4><span>Consulta, férias, pausa ou outro impedimento.</span></div>
    <form className="formStack" onSubmit={block}>
      <div className="grid2"><label>Data<input name="date" type="date" min={localDate(new Date())} required/></label><label>Motivo<input name="reason" placeholder="Ex.: Consulta"/></label></div>
      <div className="grid2"><label>Das<input name="start" type="time" required/></label><label>Até<input name="end" type="time" required/></label></div>
      <button className="secondary full">+ Adicionar bloqueio</button>
    </form>
    <div className="businessList">{blocks.filter(b=>b.member_id===selectedMember).map(b=><div className="businessListRow" key={b.id}><div><strong>{new Intl.DateTimeFormat('pt-PT',{day:'2-digit',month:'short'}).format(new Date(b.starts_at))} · {new Date(b.starts_at).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}–{new Date(b.ends_at).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}</strong><span>{b.reason||'Agenda bloqueada'}</span></div><button className="textButton" onClick={()=>void removeBlock(b.id)}>Remover</button></div>)}</div>
  </div>
}

function DormantClients({clients,services,visits,settings,onSettings}:{clients:Client[];services:Service[];visits:Visit[];settings:Settings;onSettings:(s:Settings)=>void|Promise<void>}){
  const [weeks,setWeeks]=useState(settings.dormant_after_weeks)
  const rows=useMemo(()=>clients.map(c=>{
    const history=visits.filter(v=>v.client_id===c.id).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on))
    const last=history[0]; if(!last)return null
    const limit=Number(c.dormant_after_weeks||weeks)
    const passed=weeksSince(last.occurred_on)
    const service=services.find(s=>s.id===c.preferred_service_id)
    return passed>=limit?{client:c,last,passed,limit,value:Number(service?.price||last.amount_paid||0)}:null
  }).filter(Boolean).sort((a:any,b:any)=>b.passed-a.passed) as any[],[clients,visits,weeks,services])
  async function save(){
    const next={...settings,dormant_after_weeks:Number(weeks)}
    const {error}=await supabase.from('salon_business_settings').update({dormant_after_weeks:Number(weeks),updated_at:new Date().toISOString()}).eq('salon_id',settings.salon_id)
    if(error)return alert(error.message)
    await onSettings(next)
  }
  return <div className="businessPanel">
    <div className="businessIntro"><div><span>Retenção</span><h3>Clientes adormecidos</h3></div><small>Tu decides quando um cliente passa a precisar de recuperação.</small></div>
    <div className="inlineSetting"><label>Considerar adormecido após<input type="number" min="1" max="104" value={weeks} onChange={e=>setWeeks(Number(e.target.value))}/><span>semanas</span></label><button className="secondary" onClick={()=>void save()}>Guardar</button></div>
    <div className="recoverySummary"><strong>{rows.length}</strong><span>clientes a recuperar</span><b>{euro(rows.reduce((n,r)=>n+r.value,0))}</b><span>valor potencial estimado</span></div>
    <div className="businessList">{rows.length?rows.map(r=><div className="businessListRow" key={r.client.id}><div><strong>{r.client.name}</strong><span>Última visita há {r.passed} semanas · limite {r.limit}</span></div><b>{r.value?euro(r.value):'—'}</b></div>):<p className="muted">Nenhum cliente é considerado adormecido neste momento.</p>}</div>
  </div>
}

function Loyalty({membership,clients,visits,settings,setSettings,redemptions,reload}:{membership:Member;clients:Client[];visits:Visit[];settings:Settings;setSettings:(s:Settings)=>void;redemptions:Redemption[];reload:()=>void|Promise<void>}){
  async function save(){
    const {error}=await supabase.from('salon_business_settings').update({loyalty_enabled:settings.loyalty_enabled,loyalty_visits_required:settings.loyalty_visits_required,loyalty_reward_text:settings.loyalty_reward_text,updated_at:new Date().toISOString()}).eq('salon_id',settings.salon_id)
    if(error)return alert(error.message);await reload()
  }
  function progress(clientId:string){
    const total=visits.filter(v=>v.client_id===clientId).length
    const used=redemptions.filter(r=>r.client_id===clientId).reduce((n,r)=>n+Number(r.visits_required_snapshot||0),0)
    return Math.max(0,total-used)
  }
  async function redeem(client:Client){
    const {error}=await supabase.from('loyalty_redemptions').insert({salon_id:membership.salon_id,client_id:client.id,visits_required_snapshot:settings.loyalty_visits_required,reward_text:settings.loyalty_reward_text})
    if(error)return alert(error.message);await reload()
  }
  const ranked=clients.map(c=>({client:c,count:progress(c.id)})).sort((a,b)=>b.count-a.count)
  return <div className="businessPanel">
    <div className="businessIntro"><div><span>Fidelização</span><h3>Recompensa por visitas</h3></div><small>Ex.: a cada 5 visitas, o cliente recebe uma recompensa.</small></div>
    <label className="switchLine"><input type="checkbox" checked={settings.loyalty_enabled} onChange={e=>setSettings({...settings,loyalty_enabled:e.target.checked})}/><span>Programa de fidelização ativo</span></label>
    <div className="grid2"><label>Visitas necessárias<input type="number" min="2" max="50" value={settings.loyalty_visits_required} onChange={e=>setSettings({...settings,loyalty_visits_required:Number(e.target.value)})}/></label><label>Recompensa<input value={settings.loyalty_reward_text} onChange={e=>setSettings({...settings,loyalty_reward_text:e.target.value})} placeholder="Ex.: 10% de desconto"/></label></div>
    <button className="secondary full" onClick={()=>void save()}>Guardar programa</button>
    {settings.loyalty_enabled&&<div className="businessList">{ranked.slice(0,12).map(({client,count})=>{const ready=count>=settings.loyalty_visits_required;return <div className="loyaltyRow" key={client.id}><div className="loyaltyClient"><strong>{client.name}</strong><span>{Math.min(count,settings.loyalty_visits_required)} / {settings.loyalty_visits_required} visitas</span><div className="loyaltyBar"><i style={{width:`${Math.min(100,count/settings.loyalty_visits_required*100)}%`}}/></div></div>{ready?<button className="primary small" onClick={()=>void redeem(client)}>Usar recompensa</button>:<b>{settings.loyalty_visits_required-count} em falta</b>}</div>})}</div>}
  </div>
}

function Sales({membership,members,clients,settings,sales,reload}:{membership:Member;members:Member[];clients:Client[];settings:Settings;sales:Sale[];reload:()=>void|Promise<void>}){
  const [open,setOpen]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const fd=new FormData(e.currentTarget);const total=Number(fd.get('total')||0);const pct=Number(fd.get('commission')||0)
    const payload={salon_id:membership.salon_id,client_id:String(fd.get('client_id')||'')||null,employee_id:String(fd.get('employee_id')||membership.id),occurred_at:new Date().toISOString(),subtotal:total,discount_amount:0,total_amount:total,payment_method:String(fd.get('payment_method')||'other'),commission_percent:pct,commission_amount:Math.round(total*pct)/100,notes:String(fd.get('notes')||'')||null}
    const {data,error}=await supabase.from('sales').insert(payload).select('id').single()
    if(error)return alert(error.message)
    await supabase.from('sale_items').insert({sale_id:data.id,salon_id:membership.salon_id,item_type:'custom',label:'Venda manual',quantity:1,unit_price:total,total_amount:total})
    setOpen(false);await reload()
  }
  const thisMonth=sales.filter(s=>localDate(new Date(s.occurred_at)).startsWith(monthKey()))
  return <div className="businessPanel">
    <div className="businessIntro"><div><span>Vendas</span><h3>Receita e comissões</h3></div><button className="primary small" onClick={()=>setOpen(!open)}>+ Venda</button></div>
    <div className="salesSummary"><Metric label="Vendas no mês" value={euro(thisMonth.reduce((n,s)=>n+Number(s.total_amount),0))}/><Metric label="Comissões" value={euro(thisMonth.reduce((n,s)=>n+Number(s.commission_amount),0))}/></div>
    {open&&<form className="formStack saleForm" onSubmit={submit}>
      <div className="grid2"><label>Cliente<select name="client_id"><option value="">Sem cliente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Profissional<select name="employee_id" defaultValue={membership.id}>{members.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label></div>
      <div className="grid2"><label>Total (€)<input name="total" type="number" min="0" step="0.01" required/></label><label>Comissão (%)<input name="commission" type="number" min="0" max="100" step="0.1" defaultValue={settings.commission_default_percent}/></label></div>
      <label>Pagamento<select name="payment_method"><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="mbway">MB Way</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label>
      <label>Notas <span className="optionalLabel">opcional</span><input name="notes"/></label>
      <button className="primary full">Registar venda</button>
    </form>}
    <div className="businessList">{sales.slice(0,20).map(s=><div className="businessListRow" key={s.id}><div><strong>{clients.find(c=>c.id===s.client_id)?.name||'Venda'} · {euro(s.total_amount)}</strong><span>{new Intl.DateTimeFormat('pt-PT',{day:'2-digit',month:'short'}).format(new Date(s.occurred_at))} · {members.find(m=>m.id===s.employee_id)?.display_name||'Profissional'} · {paymentLabel(s.payment_method)}</span></div><b>{s.commission_amount?euro(s.commission_amount):'—'}</b></div>)}</div>
  </div>
}
function paymentLabel(v:string){return ({cash:'Dinheiro',card:'Cartão',mbway:'MB Way',transfer:'Transferência',other:'Outro'} as Record<string,string>)[v]||v}
