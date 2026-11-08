import { useState } from 'react'

type LandingPageProps = {
  onLogin: () => void
}

const salonImage = 'https://images.unsplash.com/photo-1706629506571-a6d86798916b?auto=format&fit=crop&w=1800&q=80'
const spaceImage = 'https://images.unsplash.com/photo-1706629505300-168aa1604912?auto=format&fit=crop&w=1400&q=78'

const services = [
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

export default function LandingPage({ onLogin }: LandingPageProps){
  const [menuOpen,setMenuOpen]=useState(false)
  const [selectedService,setSelectedService]=useState('')

  function scrollTo(id:string){
    setMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'})
  }

  function book(service?:string){
    setSelectedService(service||'')
    window.setTimeout(()=>document.getElementById('marcar')?.scrollIntoView({behavior:'smooth',block:'center'}),20)
  }

  return <div className="salonSite">
    <header className="siteHeader">
      <button className="brandLockup" onClick={()=>scrollTo('inicio')} aria-label="Ir para o início">
        <span className="brandMonogram">DC</span>
        <span className="brandWords"><strong>Débora Cruz</strong><small>CABELEIREIROS</small></span>
      </button>

      <nav className={menuOpen?'siteNav open':'siteNav'}>
        <button onClick={()=>scrollTo('servicos')}>Serviços</button>
        <button onClick={()=>scrollTo('espaco')}>O espaço</button>
        <button onClick={()=>scrollTo('qualidade')}>Qualidade</button>
        <button onClick={()=>scrollTo('contactos')}>Contactos</button>
        <button className="navLogin" onClick={onLogin}>Área reservada</button>
      </nav>

      <button className="headerCta" onClick={()=>book()}>Agendar serviço</button>
      <button className="menuToggle" aria-label="Abrir menu" onClick={()=>setMenuOpen(v=>!v)}>{menuOpen?'×':'☰'}</button>
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
          {services.map(service=><article className="serviceCard" key={service.name}>
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
          <div><img src={services[0].image} alt="Trabalho de cabelo" loading="lazy"/></div>
          <div><img src={services[3].image} alt="Penteado" loading="lazy"/></div>
          <div><img src={services[2].image} alt="Cuidado de cabelo" loading="lazy"/></div>
        </div>
      </section>

      <section className="bookingBand" id="marcar">
        <div>
          <p className="eyebrowGold">Marcação</p>
          <h2>{selectedService?<>Quer marcar <em>{selectedService}</em>?</>:<>Pronta para cuidar do seu cabelo?</>}</h2>
          <p>Escolha o serviço e fale connosco. Ligamos esta área à marcação online assim que definirmos o canal final do salão.</p>
        </div>
        <div className="bookingActions">
          <button className="sitePrimary" onClick={()=>scrollTo('contactos')}>Quero agendar</button>
          <a className="instagramLink" href="https://www.instagram.com/deboracruzcabeleireiros/" target="_blank" rel="noreferrer">Instagram ↗</a>
        </div>
      </section>
    </main>

    <footer className="siteFooter" id="contactos">
      <div className="footerBrand">
        <span className="brandMonogram">DC</span>
        <div><strong>Débora Cruz</strong><small>Cabeleireiros</small></div>
      </div>
      <div className="footerCopy">
        <strong>Contactos</strong>
        <p>Os contactos finais, horário e localização podem ser ligados aqui sem alterar o restante layout.</p>
      </div>
      <div className="footerSocial">
        <strong>Siga-nos</strong>
        <a href="https://www.instagram.com/deboracruzcabeleireiros/" target="_blank" rel="noreferrer">@deboracruzcabeleireiros</a>
      </div>
      <button className="footerLogin" onClick={onLogin}>Área reservada</button>
    </footer>
  </div>
}
