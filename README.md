# Saipos Tools v6.5.1

Extensão para Google Chrome que adiciona funcionalidades extras ao painel [SAIPOS](https://conta.saipos.com): **Relatórios de Comissão**, **Happy Hour Automático**, **Resumo da Conta com Impressão** e **Importação de Produtos**.

---

## 📦 Como Instalar

1. Abra `chrome://extensions/` no Chrome
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **"Carregar sem compactação"**
4. Selecione a pasta `Saipos Tools`
5. A extensão abre como **Side Panel** — clique no ícone na barra do Chrome

---

## 📊 1. Relatório de Comissão por Garçom

Extrai vendas via API, calcula comissões e gera relatório visual completo.

### Como usar:
1. Acesse https://conta.saipos.com → **Relatórios > Vendas por Período**
2. Escolha o período e aguarde a tabela carregar
3. Abra a extensão → aba **COMISSÕES** → clique **▶ INICIAR**
4. Aguarde a coleta (barra de progresso mostra o andamento)
5. Clique em **📄 RELATÓRIO** para abrir o relatório completo

### O relatório inclui:
- Resumo por garçom (total vendido, comissão, qtd de itens)
- Detalhamento por venda (mesa, comanda, hora, itens, taxa de serviço)
- Identificação de itens isentos de taxa
- Alertas: vendas sem taxa, taxa < 10% (risco de burla), cancelamentos
- Exportação: **CSV de Itens**, **CSV de Garçons**, **CSV de Vendas**, **Copiar** e **Imprimir**

---

## 🍺 2. Happy Hour Automático

Troca o preço dos produtos automaticamente nos horários e dias configurados.

### Como configurar:
1. Abra a extensão → aba **HAPPY HOUR**
2. Preencha: nome exato do item, preço normal, preço promo
3. Selecione os dias da semana e horário de início/fim
4. Clique em **Salvar Promoção**

O preço altera automaticamente quando entra na janela de horário e volta ao normal quando sai.

- **✏️ Editar** / **🗑️ Deletar** promoções existentes
- **💾 Exportar** / **📥 Importar** backup em JSON

---

## 🧾 3. Resumo da Conta (Impressão)

Botão **"Resumo"** injetado na tela de fechamento de conta (`/table-order/close/`).

### Funcionalidades:
- Exibe modal com itens, quantidades e valores da mesa
- Lê pagamentos já realizados (pagamento parcial)
- Restaura valores originais (compensa o rateio proporcional do SAIPOS)
- Calcula saldo restante
- Gera arquivo `.saiposprt` para impressão via SAIPOS Printer

---

## 📋 4. Importar Produtos

Na aba **IMPORTAR PROD.** do painel, cole dados em formato CSV para importação em lote de produtos.

### Formato esperado:
```
nome,valor,categoria,descricao,pesado,taxa_servico
Brigadeiro,3.50,Doces,Sabores variados,N,S
```

- **Colunas**: nome, valor, categoria, descrição, pesado (S/N), taxa de serviço (S/N)
- Clique em **Importar Lote** para processar

---

## 📁 Estrutura do Projeto

```
Saipos Tools/
├── manifest.json
├── icons/             # Ícones da extensão
├── pages/             # HTMLs de interface
│   ├── popup.html
│   └── report.html
└── src/
    ├── background.js  # Service worker
    ├── content/       # Scripts injetados no site
    │   ├── interceptor.js
    │   ├── content.js
    │   └── partial-payment.js
    ├── ui/            # Scripts de interface
    │   ├── popup.js
    │   └── report-page.js
    └── lib/           # Bibliotecas auxiliares
        └── report.js
```

---

## 🔒 Segurança

- Não solicita senhas ou credenciais
- Funciona apenas em `conta.saipos.com`
- Dados permanecem restritos à sua conta

---

## ⚠️ Aviso Legal

Esta extensão é uma ferramenta **auxiliar independente**, desenvolvida para suprir funcionalidades complementares que auxiliam na operação do PDV. **Não possui vínculo oficial** com a SAIPOS.

**SAIPOS** é uma marca registrada de seus respectivos proprietários. Todos os direitos sobre a plataforma, API, nome, logotipo e demais propriedades intelectuais são **reservados exclusivamente à SAIPOS e seus detentores**.

---

_Saipos Tools v6.5.1 — Abril / 2026_
