import { FormEvent, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

type LandingPageProps = {
  onLogin: () => void
}

type PublicSiteSettings = {
  whatsapp_phone:string|null
  instagram_url:string|null
  address:string|null
  public_phone:string|null
  logo_url:string|null
}

type PublicService = {
  id:string
  name:string
  duration_minutes:number
  price:number
  image_url:string|null
}


const SALON_ID = 'c390b52f-ede9-44bc-a657-348df30110a0'
const salonImage = 'https://images.unsplash.com/photo-1706629506571-a6d86798916b?auto=format&fit=crop&w=1800&q=80'
const spaceImage = 'https://images.unsplash.com/photo-1706629505300-168aa1604912?auto=format&fit=crop&w=1400&q=78'

const fallbackServices = [
  {
    name: 'Coloração',
    text: 'Cor, brilho e dimensão com um resultado pensado para si.',
    image: 'https://images.unsplash.com/photo-1675034743339-0b0747047727?auto=format&fit=crop&w=1000&q=78'
  },
  {
    name: 'Corte',
    text: 'Um corte adaptado ao seu cabelo, estilo e rotina.',
    image: 'https://images.unsplash.com/photo-1711274094763-ff442e4719ef?auto=format&fit=crop&w=1000&q=78'
  },
  {
    name: 'Tratamentos',
    text: 'Cuidado profundo para hidratar, reparar e devolver vitalidade.',
    image: 'https://images.unsplash.com/photo-1723879371709-17908244d70a?auto=format&fit=crop&w=1000&q=78'
  },
  {
    name: 'Penteados',
    text: 'Penteados elegantes e personalizados para momentos especiais.',
    image: 'https://images.unsplash.com/photo-1742569181882-f5f05293e00f?auto=format&fit=crop&w=1000&q=78'
  }
]

function todayForInput(){
  const d=new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export default function LandingPage({ onLogin }: LandingPageProps){
  const [menuOpen,setMenuOpen]=useState(false)
  const [bookingOpen,setBookingOpen]=useState(false)
  const [selectedService,setSelectedService]=useState('')
  const [bookingBusy,setBookingBusy]=useState(false)
  const [bookingSuccess,setBookingSuccess]=useState(false)
  const [siteSettings,setSiteSettings]=useState<PublicSiteSettings>({whatsapp_phone:null,instagram_url:null,address:null,public_phone:null,logo_url:null})
  const [publicServices,setPublicServices]=useState<PublicService[]>([])

  useEffect(()=>{
    let alive=true
    Promise.all([
      supabase.from('salon_public_settings')
        .select('whatsapp_phone,instagram_url,address,public_phone,logo_url')
        .eq('salon_id',SALON_ID)
        .maybeSingle(),
      supabase.from('services')
        .select('id,name,duration_minutes,price,image_url')
        .eq('salon_id',SALON_ID)
        .eq('active',true)
        .order('name')
    ]).then(([settingsResult,servicesResult])=>{
      if(!alive) return
      if(settingsResult.data) setSiteSettings(settingsResult.data as PublicSiteSettings)
      if(servicesResult.data) setPublicServices(servicesResult.data as PublicService[])
    })
    return ()=>{alive=false}
  },[])

  const displayServices = publicServices.length
    ? publicServices.map(service=>{
        const fallback=fallbackServices.find(x=>x.name.toLowerCase()===service.name.toLowerCase())
        return {
          id:service.id,
          name:service.name,
          text:fallback?.text||'Serviço personalizado e adaptado às necessidades do seu cabelo.',
          image:service.image_url||fallback?.image||salonImage
        }
      })
    : fallbackServices.map((service,index)=>({...service,id:`fallback-${index}`}))

  const resultServices=(displayServices.length>=3?displayServices:fallbackServices.map((service,index)=>({...service,id:`fallback-result-${index}`}))).slice(0,3)

  function scrollTo(id:string){
    setMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'})
  }

  function book(service?:string){
    setSelectedService(service||'')
    setBookingSuccess(false)
    setBookingOpen(true)
  }

  function openWhatsApp(){
    const raw=(siteSettings.whatsapp_phone||'').replace(/\D/g,'')
    if(!raw) return book()
    const phone=raw.startsWith('00')?raw.slice(2):raw.length===9?'351'+raw:raw
    const message='Olá! Gostava de pedir informações / fazer uma marcação.'
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer')
  }

  async function submitBooking(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    setBookingBusy(true)
    const fd=new FormData(e.currentTarget)
    const payload={
      salon_id:SALON_ID,
      name:String(fd.get('name')||'').trim(),
      phone:String(fd.get('phone')||'').trim(),
      service_name:String(fd.get('service_name')||'').trim(),
      preferred_date:String(fd.get('preferred_date')||''),
      preferred_period:String(fd.get('preferred_period')||''),
      notes:String(fd.get('notes')||'').trim()||null
    }
    const {error}=await supabase.from('booking_requests').insert(payload)
    setBookingBusy(false)
    if(error){
      alert('Não foi possível enviar o pedido. Tente novamente.')
      return
    }
    setBookingSuccess(true)
  }

  return <div className="salonSite">
    <header className="siteHeader">
      <button className="brandLockup" onClick={()=>scrollTo('inicio')} aria-label="Ir para o início">
        {siteSettings.logo_url?
          <img className="brandUploadedLogo" src={siteSettings.logo_url} alt="Débora Cruz Cabeleireiros"/>:
          <><span className="brandMonogram">DC</span><span className="brandWords"><strong>Débora Cruz</strong><small>CABELEIREIROS</small></span></>
        }
      </button>

      <nav className={menuOpen?'siteNav open':'siteNav'}>
        <button onClick={()=>scrollTo('servicos')}>Serviços</button>
        <button onClick={()=>scrollTo('espaco')}>O espaço</button>
        <button onClick={()=>scrollTo('qualidade')}>Qualidade</button>
        <button onClick={()=>scrollTo('contactos')}>Contactos</button>
        <button className="navLogin" onClick={onLogin}>Área reservada</button>
      </nav>

      <button className="headerCta" onClick={()=>book()}>Agendar serviço</button>
      <button className={menuOpen?'menuToggle open':'menuToggle'} aria-label={menuOpen?'Fechar menu':'Abrir menu'} onClick={()=>setMenuOpen(v=>!v)}>
        {menuOpen?
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>:
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7.5h14M5 12h14M5 16.5h14"/></svg>
        }
      </button>
    </header>

    <main>
      <section className="hero" id="inicio">
        <div className="heroCopy">
          <p className="eyebrowGold">Cabeleireiros</p>
          <h1>Saúde, beleza e confiança no seu cabelo.</h1>
          <p className="heroLead">Cuidado personalizado, técnica e produtos de qualidade para resultados naturais, bonitos e pensados para si.</p>
          <div className="heroActions">
            <button className="sitePrimary" onClick={()=>book()}>Agendar serviço</button>
            <button className="siteSecondary" onClick={()=>scrollTo('servicos')}>Conhecer serviços</button>
          </div>
        </div>
        <div className="heroVisual">
          <img src={salonImage} alt="Interior elegante de um salão de cabeleireiro" />
        </div>
      </section>

      <section className="trustStrip" aria-label="Vantagens">
        <div><span>01</span><strong>Produtos profissionais</strong><small>Qualidade e cuidado em cada serviço</small></div>
        <div><span>02</span><strong>Atendimento próximo</strong><small>Escutamos antes de recomendar</small></div>
        <div><span>03</span><strong>Experiência e técnica</strong><small>Resultados bonitos e equilibrados</small></div>
      </section>

      <section className="siteSection servicesSection" id="servicos">
        <div className="sectionIntro">
          <p className="eyebrowGold">Serviços</p>
          <h2>O cuidado certo para cada cabelo.</h2>
          <p>Escolha o serviço que procura. A nossa equipa ajuda a encontrar a solução mais indicada para si.</p>
        </div>

        <div className="serviceGrid">
          {displayServices.map(service=><article className="serviceCard" key={service.id}>
            <div className="serviceImage"><img src={service.image} alt={service.name} loading="lazy"/></div>
            <div className="serviceBody">
              <h3>{service.name}</h3>
              <p>{service.text}</p>
              <button onClick={()=>book(service.name)}>Agendar {service.name.toLowerCase()}</button>
            </div>
          </article>)}
        </div>
      </section>

      <section className="qualityBand" id="qualidade">
        <div className="qualityLead">
          <p className="eyebrowGold">A nossa forma de trabalhar</p>
          <h2>Sem promessas exageradas. Bom diagnóstico, boa técnica e atenção ao detalhe.</h2>
        </div>
        <div className="qualityPoints">
          <div><strong>Diagnóstico personalizado</strong><p>O serviço começa por perceber o cabelo, o objetivo e a rotina de cada cliente.</p></div>
          <div><strong>Produtos de qualidade</strong><p>Trabalhamos com produtos profissionais escolhidos de acordo com cada necessidade.</p></div>
          <div><strong>Acompanhamento</strong><p>Recomendamos cuidados e manutenção para prolongar o resultado depois da visita.</p></div>
        </div>
      </section>

      <section className="spaceSection" id="espaco">
        <div className="spaceVisual"><img src={spaceImage} alt="Espaço de cabeleireiro com espelhos e cadeiras" loading="lazy"/></div>
        <div className="spaceCopy">
          <p className="eyebrowGold">O nosso espaço</p>
          <h2>Um ambiente pensado para cuidar de si.</h2>
          <p>Queremos que uma ida ao cabeleireiro seja um momento simples, confortável e tranquilo. Um espaço cuidado, uma equipa próxima e tempo para fazer as coisas bem.</p>
          <button className="siteTextLink" onClick={()=>book()}>Marcar uma visita <span>→</span></button>
        </div>
      </section>

      <section className="resultsSection">
        <div className="sectionIntro compact">
          <p className="eyebrowGold">Resultados</p>
          <h2>Cabelo cuidado, sem complicar.</h2>
        </div>
        <div className="resultsGrid">
          {resultServices.map(service=><div key={service.id}><img src={service.image} alt={service.name} loading="lazy"/></div>)}
        </div>
      </section>

      <section className="bookingBand" id="marcar">
        <div>
          <p className="eyebrowGold">Marcação</p>
          <h2>Pronta para cuidar do seu cabelo?</h2>
          <p>Diga-nos o serviço, o dia e se prefere manhã ou tarde. Entramos em contacto para confirmar a hora.</p>
        </div>
        <div className="bookingActions">
          <button className="sitePrimary" onClick={()=>book()}>Pedir marcação</button>
          {siteSettings.instagram_url&&<a className="instagramLink" href={siteSettings.instagram_url} target="_blank" rel="noreferrer">Instagram ↗</a>}
        </div>
      </section>
    </main>

    <footer className="siteFooter" id="contactos">
      <div className="footerBrand">
        {siteSettings.logo_url?
          <img className="footerUploadedLogo" src={siteSettings.logo_url} alt="Débora Cruz Cabeleireiros"/>:
          <><span className="brandMonogram">DC</span><div><strong>Débora Cruz</strong><small>Cabeleireiros</small></div></>
        }
      </div>
      <div className="footerCopy">
        <strong>Contactos</strong>
        {siteSettings.public_phone&&<a className="footerContactLink" href={`tel:${siteSettings.public_phone.replace(/\s/g,'')}`}>{siteSettings.public_phone}</a>}
        {siteSettings.address&&<p className="footerAddress">{siteSettings.address}</p>}
        {!siteSettings.public_phone&&!siteSettings.address&&<p>Contacte-nos através do formulário de marcação.</p>}
      </div>
      {siteSettings.instagram_url&&<div className="footerSocial">
        <strong>Siga-nos</strong>
        <a href={siteSettings.instagram_url} target="_blank" rel="noreferrer">Instagram ↗</a>
      </div>}
      <button className="footerLogin" onClick={onLogin}>Área reservada</button>
    </footer>

    {!bookingOpen&&<>
      <button className="mobileWhatsApp" onClick={openWhatsApp} aria-label="Falar no WhatsApp" title="WhatsApp">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16.04 4.5A11.34 11.34 0 0 0 6.3 21.65L4.5 27.5l6-1.72A11.35 11.35 0 1 0 16.04 4.5Zm0 20.55a9.18 9.18 0 0 1-4.68-1.28l-.34-.2-3.56 1.02 1.06-3.46-.22-.35a9.18 9.18 0 1 1 7.74 4.27Zm5.04-6.86c-.28-.14-1.64-.81-1.89-.9-.25-.09-.44-.14-.62.14-.18.28-.71.9-.87 1.09-.16.18-.32.21-.6.07-.27-.14-1.16-.43-2.21-1.37-.82-.73-1.37-1.63-1.53-1.91-.16-.28-.02-.43.12-.56.13-.12.28-.32.41-.48.14-.16.18-.28.28-.46.09-.18.05-.35-.02-.49-.07-.14-.62-1.5-.85-2.05-.22-.54-.45-.47-.62-.48h-.53c-.18 0-.48.07-.73.35-.25.28-.96.94-.96 2.29s.98 2.65 1.12 2.84c.14.18 1.93 2.94 4.67 4.12.65.28 1.16.45 1.56.58.66.21 1.25.18 1.72.11.53-.08 1.64-.67 1.87-1.32.23-.65.23-1.21.16-1.32-.07-.12-.25-.19-.53-.33Z"/>
        </svg>
      </button>
      <div className="mobileStickyBooking">
        <button onClick={()=>book()}>
          <svg className="bookingCalendarIcon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 3v3M17 3v3M4.5 8.5h15M6.5 5h11a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/>
            <path d="m9.2 13 1.8 1.8 3.8-4"/>
          </svg>
          Agendar serviço
        </button>
      </div>
    </>}

    {bookingOpen&&<div className="bookingModalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setBookingOpen(false)}}>
      <div className="bookingModal" role="dialog" aria-modal="true" aria-labelledby="booking-title">
        <div className="bookingModalHead">
          <div><p className="eyebrowGold">Marcação</p><h2 id="booking-title">Pedir marcação</h2></div>
          <button className="bookingClose" onClick={()=>setBookingOpen(false)} aria-label="Fechar">×</button>
        </div>

        {bookingSuccess?<div className="bookingSuccess">
          <span>✓</span>
          <h3>Pedido enviado</h3>
          <p>Recebemos o seu pedido. O salão entrará em contacto para confirmar o horário.</p>
          <button className="sitePrimary" onClick={()=>setBookingOpen(false)}>Fechar</button>
        </div>:<form className="bookingForm" onSubmit={submitBooking}>
          <label>Nome
            <input name="name" required autoComplete="name" placeholder="O seu nome"/>
          </label>
          <label>Telemóvel
            <input name="phone" required type="tel" inputMode="tel" autoComplete="tel" placeholder="9xx xxx xxx"/>
          </label>
          <label>Serviço
            <select name="service_name" required value={selectedService} onChange={e=>setSelectedService(e.target.value)}>
              <option value="">Escolha um serviço</option>
              {displayServices.map(s=><option key={s.id} value={s.name}>{s.name}</option>)}
              <option value="Outro">Outro</option>
            </select>
          </label>
          <label>Dia preferencial
            <input name="preferred_date" required type="date" min={todayForInput()}/>
          </label>

          <fieldset className="periodField">
            <legend>Horário preferencial</legend>
            <div className="periodChoice">
              <label><input type="radio" name="preferred_period" value="morning" required/><span>Manhã</span></label>
              <label><input type="radio" name="preferred_period" value="afternoon" required/><span>Tarde</span></label>
            </div>
          </fieldset>

          <label>Nota <small>opcional</small>
            <textarea name="notes" placeholder="Alguma preferência ou informação importante?"/>
          </label>

          <button className="sitePrimary bookingSubmit" disabled={bookingBusy}>{bookingBusy?'A enviar…':'Enviar pedido'}</button>
          <p className="bookingFinePrint">Este pedido não confirma automaticamente a marcação. O salão entrará em contacto para confirmar a disponibilidade.</p>
        </form>}
      </div>
    </div>}
  </div>
}
