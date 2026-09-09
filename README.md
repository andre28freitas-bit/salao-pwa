# Salão PWA V2

PWA mobile-first para agenda, clientes, histórico técnico, retenção, WhatsApp e stock.

## O que já está preparado

- Supabase Auth (email/password)
- Primeiro utilizador cria o salão e fica `owner`
- Convites de equipa por código
- RLS: `employee` vê apenas as próprias marcações; `manager`/`owner` vê toda a agenda
- Agenda diária + vista Minha/Equipa para gerente
- Botão para exportar marcação em `.ics` para o calendário do telemóvel
- Ficha de cliente + histórico (cor/fórmula, tratamentos, notas, valor)
- Alertas de recorrência + WhatsApp pré-preenchido
- Importação de contacto do telemóvel quando o browser suporta Contact Picker
- Stock com código de barras e movimentos auditáveis
- Scanner pela câmara quando `BarcodeDetector` é suportado; introdução manual como fallback
- Realtime para agenda/clientes/visitas/produtos
- PWA instalável e app shell offline

## 1. Criar a base de dados

No Supabase: **SQL Editor > New Query**. Cola todo o conteúdo de `supabase/schema.sql` e carrega em **Run**.

## 2. Obter URL e publishable key

No projeto Supabase abre **Connect**. Copia:

- Project URL
- Publishable key (`sb_publishable_...`)

Não uses uma secret key nem `service_role` no frontend.

## 3. Variáveis de ambiente

Copia `.env.example` para `.env` e preenche:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
```

## 4. Executar localmente

```bash
npm install
npm run dev
```

## 5. Build

```bash
npm run build
```

O output fica em `dist/`.

## 6. Cloudflare

Liga o repositório GitHub ao Cloudflare e usa:

- Build command: `npm run build`
- Output directory: `dist`
- Node: versão atual LTS

Adiciona as duas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` nas Environment Variables do projeto antes do primeiro build.

## Segurança

O frontend deve conter apenas a **publishable key**. A segurança de dados está nas políticas RLS do SQL. A V2 nunca precisa de `service_role`/secret key no browser.
