/**
 * ARQUIVO: js/config.js
 * DESCRIÇÃO: Configurações globais, Firebase e Regras de Negócio.
 */

// 1. CARREGA VARIÁVEIS DE AMBIENTE (.env)
export const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_APP_ID
};

// Admin Hardcoded (Backup)
export const ADMIN_IDS = ["lssiHZQUGEMF9E2OPnv3iqIyjRW2"];

// 2. DETECÇÃO DE AMBIENTE (DEV vs PROD)
export const IS_DEV = import.meta.env.DEV;

// 3. DEFINIÇÃO DE CAMINHOS (COLEÇÕES)
// Se estiver em DEV e usando o mesmo projeto de prod, adiciona '_test' para não sujar o banco real.
const suffix = (IS_DEV && firebaseConfig.projectId === "genapplog") ? '_test' : '';

export const PATHS = {
    clients: `artifacts/${firebaseConfig.appId}/public/data/clients${suffix}`,
    occurrences: `artifacts/${firebaseConfig.appId}/public/data/occurrences${suffix}`,
    users: 'users',      // Compartilhado (Login)
    products: 'products' // Compartilhado (Base de Produtos)
};

// 4. REGRAS DE CHECKLIST (PADRÃO)
export const defaultChecklistData = { 
    alturaPalete: { directa: "1.80M", fracionada: "1.80M" }, 
    multiplosSKU: { directa: "", fracionada: "", directaLimit: "", fracionadaLimit: "" },
    multiplosLotes: { directa: "", fracionada: "", directaLimit: "", fracionadaLimit: "" },
    multiplosPedidos: { directa: "NÃO", fracionada: "NÃO", directaLimit: "", fracionadaLimit: "" },
    paletizacaoLastro: { directa: "", fracionada: "" },
    paletizacaoTorre: { directa: "", fracionada: "" },
    tipoPalete: { directa: "PBR", fracionada: "PBR" },
    observacao: { directa: "", fracionada: "" } 
};

export const checklistRowsConfig = [
    { key: 'alturaPalete', label: 'ALTURA PALETE' },
    { key: 'multiplosSKU', label: 'MÚLTIPLOS SKU' },
    { key: 'multiplosLotes', label: 'MÚLTIPLOS LOTES' },
    { key: 'multiplosPedidos', label: 'MÚLTIPLOS PEDIDO / NF' },
    { key: 'paletizacaoLastro', label: 'PALETIZAÇÃO LASTRO' },
    { key: 'paletizacaoTorre', label: 'PALETIZAÇÃO TORRE' },
    { key: 'tipoPalete', label: 'TIPO PALETE' },
    { key: 'observacao', label: 'OBSERVAÇÃO' }
];

export const specificClientRules = { 
    "AMAZON": { 
        ...defaultChecklistData, 
        observacao: { directa: "EXIGE AGENDAMENTO PRÉVIO (CARP).", fracionada: "EXIGE AGENDAMENTO PRÉVIO (CARP)." } 
    } 
};

// 5. DADOS DE ETIQUETAS (CDs AMAZON) - JÁ EM UPPERCASE
export const cdData = { 
    "GRU5": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000367", ie: "241099810118", linha1: "CD PROLOGIS 3: AV. ANTONIO CANDIDO MACHADO", linha2: "3100 ANDAR 5, 07776415 - CAJAMAR - SP" },
    "XBRA": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000448", ie: "241118709114", linha1: "CD PROLOGIS 2: AV. DR. JOAO ABDALLA 260", linha2: "BLOCO 400, 07776700 - CAJAMAR - SP" },
    "XBRB": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000529", ie: "0842859-07", linha1: "RD BR-101 SUL, 3791BL C, GALPÃO 5, SL A", linha2: "54503010 - CABO DE SANTO AGOSTINHO - PE" },
    "XBRT": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000871", ie: "241134643114", linha1: "VIA DE ACESSO NORTE KM 38, 420, GALPÃO 07", linha2: "GLEBA A BLOCO 07, 07789100 CAJAMAR - SP" },
    "XBRZ": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000286", ie: "241115791117", linha1: "CD PROLOGIS 2: AV. DR. JOAO ABDALLA 260", linha2: "BLOCO 300, 07776700 CAJAMAR - SP" },
    "CNF1": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000952", ie: "002668590054", linha1: "AVENIDA JUIZ MARCO TULIO ISAAC 7000", linha2: "32670250, BETIM - MG" },
    "BSB1": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940001096", ie: "0774927400365", linha1: "RD DF, 290, KM 1.2 LOTE 13,14,15,16 E 17", linha2: "72501100, BRASILIA - DF" },
    "POA1": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940001177", ie: "3820025709", linha1: "RUA DA PEDREIRA, 64, PAVILHÃO 05", linha2: "92480000, NOVA SANTA RITA - RS" },
    "GIG1": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940001410", ie: "11821987", linha1: "AV ARTHUR ANTONIO SENDAS, S/N AREA 6A", linha2: "25585021, SAO JOAO DE MERITI, RJ" },
    "REC1": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "11543694000150", ie: "0920380-00", linha1: "RD BR 101 SUL, 9415, GALPÃO B", linha2: "54503010 - CABO DE SANTO AGOSTINHO - PE" },
    "FOR2": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940001681", ie: "61268801", linha1: "AV QUARTO ANEL VIARIO, 4343", linha2: "61880000, ITAITINGA - CE" } 
};

export const labelDimensions = { 
    "4x6": { pw: 800, ll: 1200, aspect: "aspect-[2/3]" }, 
    "4x4": { pw: 800, ll: 800, aspect: "aspect-square" }, 
    "4x2": { pw: 800, ll: 400, aspect: "aspect-[2/1]" }, 
    "4x3.15": { pw: 800, ll: 640, aspect: "aspect-[10/8]" } 
};