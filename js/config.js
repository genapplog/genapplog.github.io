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
// (Removemos cdData e labelDimensions daqui pois foram para labels-data.js)