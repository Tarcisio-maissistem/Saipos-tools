# Saipos Tools v4.8.0

Extensão oficial para Google Chrome que adiciona funcionalidades avançadas ao painel do sistema **Saipos**.

## 📦 Instalação

1. Abra o Chrome e acesse `chrome://extensions/`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta raiz da extensão (`Saipos Extensão v3.17`)

---

## 🚀 Funcionalidade 1: Automação de Happy Hour (NOVO)

Esta funcionalidade foi desenvolvida utilizando integração direta com a API nativa do Saipos via injeção de Headers e Proxy Requests, sem travamentos na tela.

### Como Usar
1. Acesse o painel principal do Saipos ou cardápio.
2. Clique no ícone da extensão para abrir a interface no topo direito.
3. Na seção **Happy Hour**, preencha:
   - **Nome do Produto**: Exatamente igual ao que consta no Saipos (Ex: `SKOL 600ML`).
   - **Preço Normal**: O valor fora de promoção.
   - **Preço Automático (Promo)**: O valor desejado de desconto.
   - **Dias da semana e Horário**: Período de vigência da promoção.
4. Clique em **Salvar**. A extensão fará tudo sozinha!

### Recursos Técnicos (API Direta)
- **Zero Interferência**: Monitora silenciosamente o horário (`background task`) a cada 30 segundos.
- **Auto-Configuração**: Atualização real de preços (incluindo todas as variações do produto) diretamente no banco de dados via requisições `PUT`.
- **Prevenção Conflitos**: Bloqueia injeção de tokens de terceiros (ex: Pendo Analytics) via intercepção assíncrona.
- **Edição em Tempo Real**: Altere valores sem precisar apagar a regra clicando no botão **Editar**.

---

## 📊 Funcionalidade 2: Relatório de Comissão de Garçons (Legado)

Extrator de dados de vendas para cálculo automático de comissão proporcional aos itens vendidos na mesa.

### Como Usar
1. Navegue até: **Relatórios > Vendas por Período**
2. Aplique o filtro de datas desejado e aguarde a tabela principal carregar.
3. Abra a extensão e clique em **▶ INICIAR**.
4. Não navegue em outras abas. O robô vai paginar todas as vendas usando *DOM Scraping*.
5. Após 100%, clique em **📄 RELATÓRIO** para abrir o dashboard consolidado.

### O Que Entra no Relatório?
- Exportação por CSV de Garçons, Itens detalhados e Resumo Geral.
- Divisão real de **Taxa de Serviço** proporcional ao valor total.
- Alertas independentes de vendas zeradas ou canceladas.

---

## 📁 Estrutura de Arquivos

```
Saipos Extensão/
├── manifest.json      # Configuração da extensão e permissões de Host
├── popup.html         # Interface HTML Moderna (Design Saipos Blue)
├── README.md          # Este arquivo
└── src/
    ├── background.js  # Service worker para persistência
    ├── content.js     # Script principal (DOM/API Fetcher Isolado)
    ├── interceptor.js # Captura de Bearer Auth/JWT silenciado
    ├── popup.js       # Controle de state do formulário e Local Storage
    └── report.js      # Geração do relatório HTML customizado
```

## ⚠️ Segurança & Requisitos
- **Google Chrome** versão 88 ou superior recomendada.
- **Sem senhas**: A extensão reutiliza as credenciais seguras do login ativo no navegador. Não há armazenamento de dados sensíveis na extensão.

---

**Versão**: 4.8.0  
**Última atualização**: Abril 2026
