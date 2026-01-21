/**
 * ARQUIVO: js/config.js
 * DESCRIÇÃO: Configurações globais e Seleção Inteligente de Ambiente (Prod/Teste).
 */

// 1. CREDENCIAIS DE PRODUÇÃO (Projeto: genapplog)
// Copie do Console Firebase > genapplog > Configurações do Projeto
const configProducao = {
    apiKey: "AIzaSyABGUTSwBMEuNLmFDsNRHgXOo3NEs8Q21A",
    authDomain: "genapplog.firebaseapp.com",
    projectId: "genapplog",
    storageBucket: "genapplog.firebasestorage.app",
    messagingSenderId: "787938700532",
    appId: "1:787938700532:web:442b667367341fb4ac02a1"
};

// 2. CREDENCIAIS DE TESTE (Projeto: genapplog-dev)
// Copie do Console Firebase > genapplog-dev > Configurações do Projeto
const configTeste = {
    apiKey: "AIzaSyATlLsFES_JwcyfyluRhng4FzVfQC4fcus",
    authDomain: "genapplog-dev.firebaseapp.com",
    projectId: "genapplog-dev", // O SEGREDO: ID diferente = Banco diferente
    storageBucket: "genapplog-dev.firebasestorage.app",
    messagingSenderId: "948279995498",
    appId: "1:948279995498:web:04b4a6c9c5d708500bee13"
};

// 3. LÓGICA DE SELEÇÃO AUTOMÁTICA
const hostname = window.location.hostname;

// Se o link tiver "teste" ou for local, ativa modo DEV
export const IS_DEV = hostname.includes('teste') || hostname.includes('localhost') || hostname.includes('127.0.0.1');

// Exporta a configuração escolhida para o app.js usar
export const firebaseConfig = IS_DEV ? configTeste : configProducao;

// Admin Hardcoded (Mantido)
export const ADMIN_IDS = ["lssiHZQUGEMF9E2OPnv3iqIyjRW2"];

// 4. CAMINHOS DAS COLEÇÕES
// Nota: Como agora são bancos separados, não precisamos mais do sufixo "_test" nas coleções.
// As coleções terão o mesmo nome "limpo" em ambos os bancos.
export const PATHS = {
    clients: `artifacts/${firebaseConfig.appId}/public/data/clients`,
    occurrences: `artifacts/${firebaseConfig.appId}/public/data/occurrences`,
    users: 'users',
    products: 'products'
};

// 5. REGRAS DE CHECKLIST (PADRÃO)
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