import { FormEvent, useState } from 'react'

const barberServices = [
  {
    name:'Corte',
    text:'Corte personalizado, acabamento limpo e atenção ao detalhe.',
    image:'https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=1200&q=82'
  },
  {
    name:'Barba',
    text:'Contorno, definição e cuidado para uma barba sempre alinhada.',
    image:'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1200&q=82'
  },
  {
    name:'Corte + Barba',
    text:'O serviço completo para sair com tudo no ponto.',
    image:'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=1200&q=82'
  },
  {
    name:'Acabamento',
    text:'Detalhes, linhas e manutenção rápida entre cortes.',
    image:'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=1200&q=82'
  }
]

function todayForInput(){
  const d=new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export default function BarberDemo(){
  const [menuOpen,setMenuOpen]=useState(false)
  const [bookingOpen,setBookingOpen]=useState(false)
  const [selectedService,setSelectedService]=useState('')
  const [success,setSuccess]=useState(false)

  function scrollTo(id:string){
    setMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'})
  }

  function book(service?:string){
    setSelectedService(service||'')
    setSuccess(false)
    setBookingOpen(true)
  }

  function openWhatsApp(){
    const message='Olá! Gostava de fazer uma marcação na 13 Barbers.'
    window.open(`https://wa.me/351910608451?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer')
  }

  function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    setSuccess(true)
  }

  return <div className="barberSite">
    <header className="barberHeader">
      <button className="barberBrand" onClick={()=>scrollTo('barber-inicio')} aria-label="Ir para o início">
        <span className="barberMark">13</span>
        <span><strong>13 BARBERS</strong><small>BARBEARIA · BRAGA</small></span>
      </button>

      <nav className={menuOpen?'barberNav open':'barberNav'}>
        <button onClick={()=>scrollTo('barber-servicos')}>Serviços</button>
        <button onClick={()=>scrollTo('barber-espaco')}>A barbearia</button>
        <button onClick={()=>scrollTo('barber-horario')}>Horário</button>
        <button onClick={()=>scrollTo('barber-contactos')}>Contactos</button>
      </nav>

      <button className="barberHeaderCta" onClick={()=>book()}>Marcar agora</button>
      <button className={menuOpen?'barberMenu open':'barberMenu'} onClick={()=>setMenuOpen(v=>!v)} aria-label={menuOpen?'Fechar menu':'Abrir menu'}>
        {menuOpen?
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>:
          <svg viewBox="0 0 24 24"><path d="M5 7.5h14M5 12h14M5 16.5h14"/></svg>
        }
      </button>
    </header>

    <main>
      <section className="barberHero" id="barber-inicio">
        <div className="barberHeroImage">
          <img src="https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=1800&q=85" alt="Barbearia masculina"/>
        </div>
        <div className="barberHeroOverlay"/>
        <div className="barberHeroCopy">
          <p className="barberEyebrow">BARBEARIA · BRAGA</p>
          <h1>Corte certo.<br/>Barba alinhada.<br/><em>Sem complicações.</em></h1>
          <p>Um espaço pensado para homens que valorizam um bom corte, um serviço próximo e sair sempre no ponto.</p>
          <div className="barberHeroActions">
            <button className="barberPrimary" onClick={()=>book()}>Marcar serviço</button>
            <button className="barberGhost" onClick={()=>scrollTo('barber-servicos')}>Ver serviços</button>
          </div>
        </div>
        <div className="barberHeroMeta">
          <span>Por marcação</span>
          <span>Ter–Sex · 09h–20h</span>
          <span>Sáb · 09h–18h</span>
        </div>
      </section>

      <section className="barberIntro">
        <div><span>01</span><strong>Sem esperas desnecessárias</strong><p>Marca, aparece e senta-te. Simples.</p></div>
        <div><span>02</span><strong>Atenção ao detalhe</strong><p>Do degradê ao acabamento final.</p></div>
        <div><span>03</span><strong>Experiência próxima</strong><p>Serviço cuidado, ambiente descontraído.</p></div>
      </section>

      <section className="barberSection" id="barber-servicos">
        <div className="barberSectionHead">
          <div><p className="barberEyebrow">SERVIÇOS</p><h2>O essencial,<br/><em>bem feito.</em></h2></div>
          <p>Escolhe o serviço que precisas e indica o dia que te dá mais jeito. A confirmação é feita diretamente pela barbearia.</p>
        </div>

        <div className="barberServiceGrid">
          {barberServices.map((service,index)=><article className="barberServiceCard" key={service.name}>
            <div className="barberServiceImage"><img src={service.image} alt={service.name} loading="lazy"/><span>0{index+1}</span></div>
            <div className="barberServiceBody">
              <div><h3>{service.name}</h3><p>{service.text}</p></div>
              <button onClick={()=>book(service.name)} aria-label={`Marcar ${service.name}`}>↗</button>
            </div>
          </article>)}
        </div>
      </section>

      <section className="barberSpace" id="barber-espaco">
        <div className="barberSpaceCopy">
          <p className="barberEyebrow">13 BARBERS</p>
          <h2>Um bom corte começa <em>num bom ambiente.</em></h2>
          <p>Sem pressas, sem formalidades. Um espaço masculino, simples e cuidado, para tratar do corte e da barba como deve ser.</p>
          <button onClick={()=>book()}>Quero marcar <span>→</span></button>
        </div>
        <div className="barberSpaceImage"><img src="https://images.unsplash.com/photo-1622296089863-eb7fc530daa8?auto=format&fit=crop&w=1500&q=82" alt="Interior de barbearia" loading="lazy"/></div>
      </section>

      <section className="barberSchedule" id="barber-horario">
        <p className="barberEyebrow">HORÁRIO</p>
        <div className="barberScheduleGrid">
          <h2>Quando te dá<br/><em>mais jeito?</em></h2>
          <div className="barberHours">
            <div><span>Terça — Sexta</span><strong>09:00 — 20:00</strong></div>
            <div><span>Sábado</span><strong>09:00 — 18:00</strong></div>
            <div><span>Domingo — Segunda</span><strong>Descanso</strong></div>
          </div>
        </div>
      </section>

      <section className="barberFinalCta">
        <div><p className="barberEyebrow">MARCAÇÃO</p><h2>Está na altura<br/>do próximo corte?</h2></div>
        <button className="barberPrimary light" onClick={()=>book()}>Escolher serviço</button>
      </section>
    </main>

    <footer className="barberFooter" id="barber-contactos">
      <div className="barberFooterBrand"><span className="barberMark">13</span><div><strong>13 BARBERS</strong><small>BARBEARIA · BRAGA</small></div></div>
      <div><small>CONTACTO</small><a href="tel:910608451">910 608 451</a></div>
      <div><small>INSTAGRAM</small><a href="https://www.instagram.com/13barbers/" target="_blank" rel="noreferrer">@13barbers</a></div>
      <div><small>LOCALIZAÇÃO</small><span>Braga, Portugal</span></div>
      <p className="barberDemoNote">Demonstração visual</p>
    </footer>

    {!bookingOpen&&<>
      <button className="barberWhatsapp" onClick={openWhatsApp} aria-label="Falar no WhatsApp">
        <svg viewBox="0 0 32 32"><path d="M16.04 4.5A11.34 11.34 0 0 0 6.3 21.65L4.5 27.5l6-1.72A11.35 11.35 0 1 0 16.04 4.5Zm0 20.55a9.18 9.18 0 0 1-4.68-1.28l-.34-.2-3.56 1.02 1.06-3.46-.22-.35a9.18 9.18 0 1 1 7.74 4.27Zm5.04-6.86c-.28-.14-1.64-.81-1.89-.9-.25-.09-.44-.14-.62.14-.18.28-.71.9-.87 1.09-.16.18-.32.21-.6.07-.27-.14-1.16-.43-2.21-1.37-.82-.73-1.37-1.63-1.53-1.91-.16-.28-.02-.43.12-.56.13-.12.28-.32.41-.48.14-.16.18-.28.28-.46.09-.18.05-.35-.02-.49-.07-.14-.62-1.5-.85-2.05-.22-.54-.45-.47-.62-.48h-.53c-.18 0-.48.07-.73.35-.25.28-.96.94-.96 2.29s.98 2.65 1.12 2.84c.14.18 1.93 2.94 4.67 4.12.65.28 1.16.45 1.56.58.66.21 1.25.18 1.72.11.53-.08 1.64-.67 1.87-1.32.23-.65.23-1.21.16-1.32-.07-.12-.25-.19-.53-.33Z"/></svg>
      </button>
      <div className="barberSticky"><button onClick={()=>book()}>
        <svg viewBox="0 0 24 24"><path d="M7 3v3M17 3v3M4.5 8.5h15M6.5 5h11a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="m9.2 13 1.8 1.8 3.8-4"/></svg>
        Marcar serviço
      </button></div>
    </>}

    {bookingOpen&&<div className="barberModalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setBookingOpen(false)}}>
      <div className="barberModal" role="dialog" aria-modal="true">
        <div className="barberModalHead">
          <div><p className="barberEyebrow">MARCAÇÃO</p><h2>Pedir marcação</h2></div>
          <button onClick={()=>setBookingOpen(false)} aria-label="Fechar">×</button>
        </div>
        {success?<div className="barberSuccess"><span>✓</span><h3>Pedido simulado</h3><p>Na versão final, este pedido entra automaticamente no back-office da barbearia para confirmação.</p><button className="barberPrimary" onClick={()=>setBookingOpen(false)}>Fechar</button></div>:
        <form className="barberForm" onSubmit={submit}>
          <label>Nome<input name="name" required placeholder="O teu nome"/></label>
          <label>Telemóvel<input name="phone" type="tel" inputMode="tel" required placeholder="9xx xxx xxx"/></label>
          <label>Serviço<select required value={selectedService} onChange={e=>setSelectedService(e.target.value)}><option value="">Escolher serviço</option>{barberServices.map(s=><option key={s.name}>{s.name}</option>)}</select></label>
          <label>Dia preferencial<input type="date" min={todayForInput()} required/></label>
          <label>Preferência<select required defaultValue=""><option value="" disabled>Escolher período</option><option>Manhã</option><option>Tarde</option><option>Não tenho preferência</option></select></label>
          <button className="barberPrimary" type="submit">Enviar pedido</button>
          <small>Esta página é uma demonstração e não cria uma marcação real.</small>
        </form>}
      </div>
    </div>}
  </div>
}
