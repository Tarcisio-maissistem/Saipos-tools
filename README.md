# Saipos Tools v3.16.0

Extensão para Google Chrome que extrai dados de vendas do sistema Saipos para cálculo de comissão dos garçons.

## 📦 Instalação

1. Abra o Chrome e acesse `chrome://extensions/`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `Saipos Extensão`

## 🚀 Como Usar

### 1. Preparação
1. Acesse o Saipos: https://conta.saipos.com
2. Faça login com as credenciais:
   - E-mail: `relatorio@oasis`
   - Senha: `oasis2026`
3. Navegue até: **Relatórios > Vendas por Período**
4. Aplique o filtro de datas desejado
5. Aguarde a tabela de vendas carregar

### 2. Execução
1. Clique no ícone da extensão (Saipos Tools)
2. Clique em **▶ INICIAR**
3. Acompanhe o progresso no popup:
   - **LOG**: Histórico de ações em tempo real
   - **GARÇONS**: Resumo por garçom (atualizado ao final)
   - **ALERTAS**: Vendas sem taxa ou com taxa baixa

### 3. Controles
- **⏸ PAUSAR**: Pausa/retoma a extração
- **■ PARAR**: Interrompe definitivamente
- **📄 RELATÓRIO**: Gera o relatório completo (disponível após conclusão)

## 📊 Relatório

O relatório abre em nova aba com:

### Visão Geral
- Total em itens vendidos
- Taxa de serviço total
- Taxa média percentual
- Contadores de alertas

### Por Data
- Cada dia com suas vendas agrupadas
- Por venda: mesa, comanda, horário, pagamento
- Tabela de itens com garçom, valor, comissão
- Subtotal por garçom em cada venda
- Resumo do dia por garçom

### Resumo Global
- Tabela consolidada por garçom
- Total vendido, comissão total, quantidade de itens

### Alertas
- Vendas sem taxa de serviço
- Vendas com taxa < 10%
- Vendas canceladas

## 📥 Exportação

O relatório oferece várias opções de exportação:

| Botão | Descrição |
|-------|-----------|
| 📋 Copiar Tudo | Copia o relatório completo para área de transferência |
| 🖨️ Imprimir | Abre diálogo de impressão/PDF |
| 📊 CSV Itens | Exporta todos os itens detalhados |
| 📊 CSV Garçons | Exporta resumo por garçom |
| 📊 CSV Vendas | Exporta resumo por venda |

### Formato CSV
- Separador: `;` (ponto e vírgula) - compatível com Excel BR
- Encoding: UTF-8 com BOM (acentos funcionam)
- Decimais: vírgula (formato brasileiro)

## ⚙️ Funcionalidades

### Extração
- ✅ Leitura automática da tabela de vendas
- ✅ Navegação automática pelos modais (Ver → Detalhamento)
- ✅ Suporte a paginação (múltiplas páginas)
- ✅ Proteção contra duplicatas
- ✅ Detecção de itens/vendas cancelados

### Dados Capturados por Venda
- Mesa e comanda
- Data/hora
- Forma de pagamento
- Total de itens
- Taxa de serviço (valor real pago)
- Status (cancelada ou não)

### Dados Capturados por Item
- Nome do item
- Quantidade
- Garçom responsável
- Valor unitário
- Status (cancelado ou não)

### Cálculo de Comissão
A comissão de cada item é calculada proporcionalmente:

```
Comissão Item = (Valor Item / Total Itens) × Taxa de Serviço
```

Considera o **valor real pago** de taxa, não o percentual configurado.

## 🔧 Requisitos Técnicos

- Google Chrome (versão 88+)
- Acesso ao sistema Saipos em https://conta.saipos.com
- Tela de Relatórios > Vendas por Período

## ⚠️ Observações

1. **Não feche o popup** durante a extração
2. **Não navegue** para outras páginas durante o processo
3. A extensão opera via DOM scraping (sem API)
4. Recarregue a página e a extensão se houver erros

## 📁 Estrutura de Arquivos

```
Saipos Extensão/
├── manifest.json      # Configuração da extensão
├── popup.html         # Interface do popup
├── README.md          # Este arquivo
└── src/
    ├── background.js  # Service worker
    ├── content.js     # Script de extração (DOM)
    ├── popup.js       # Lógica do popup
    └── report.js      # Geração do relatório HTML
```

## 🆘 Solução de Problemas

| Problema | Solução |
|----------|---------|
| "Nenhuma venda encontrada" | Aplique o filtro de datas e aguarde carregar |
| Modal não abre | Aumente o delay ou recarregue a página |
| Dados incorretos | Verifique se a estrutura do Saipos mudou |
| Exportação não funciona | Verifique se popups estão permitidos |

---

**Versão**: 3.1.0  
**Última atualização**: Março 2026
