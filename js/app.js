/**
 * ARQUIVO: js/app.js
 * DESCRIÇÃO: Ponto de entrada da aplicação (Router, Init, Segurança).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager,
    collection,
    addDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ✅ CORREÇÃO: Importando IS_DEV (o nome correto agora)
import { firebaseConfig, PATHS, IS_DEV } from './config.js';
import { safeBind, showToast } from './utils.js';

// Módulos
import { initAuth } from './modules/auth.js';
import { initLabelsModule } from './modules/labels.js';
import { initClientsModule, refreshClientList } from './modules/clients.js';
import { initRncModule } from './modules/rnc.js';
import { initAdminModule } from './modules/admin.js';
import { initDashboard, startTVMode } from './modules/dashboard.js';

// =========================================================
// 1. INICIALIZAÇÃO FIREBASE (CORE)
// =========================================================
const app = initializeApp(firebaseConfig);

// ✅ LÓGICA DO APP CHECK: Desativa em Localhost (IS_DEV)
if (!IS_DEV) {
    try {
        initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider('6LcIwEosAAAAAO2Ph6II8msIeZnBa9wr6JV3Kut7'),
            isTokenAutoRefreshEnabled: true
        });
        console.log("🛡️ App Check ativado (Produção).");
    } catch (e) {
        console.warn("Aviso App Check:", e);
    }
} else {
    console.log("🚧 Modo DEV: App Check desativado para evitar bloqueios.");
}

const auth = getAuth(app);

// Banco de Dados com Cache Offline (PWA)
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    })
});

// =========================================================
// 2. CICLO DE VIDA DA APLICAÇÃO
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log(`🚀 AppLog Iniciando... Ambiente: ${IS_DEV ? 'DESENVOLVIMENTO' : 'PRODUÇÃO'}`);

    // Configurações Iniciais
    setupEnvironmentUI();
    setupNavigation();
    
    // Inicia Módulos Independentes
    initLabelsModule();
    initAuth(auth); 

    // ✅ CORREÇÃO: Força a lista de clientes a atualizar as permissões após o login
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // Aguarda 1 segundo para garantir que o perfil de Admin foi carregado na memória
            setTimeout(() => {
                console.log("🔄 Recarregando lista de clientes com permissões de Admin...");
                refreshClientList();
            }, 1000);
        }
    });

    // Inicia Módulos Conectados ao DB
    const clientsCollection = collection(db, PATHS.clients);
    
    // Inicialização Paralela para performance
    await Promise.all([
        initClientsModule(clientsCollection),
        // Passamos IS_DEV para o módulo RNC saber como se comportar
        initRncModule(db, IS_DEV), 
        initAdminModule(db, clientsCollection)
    ]);

    // Funcionalidades Globais de Estabilidade
    // Executa imediatamente e depois a cada 2s para pegar modais novos
    blindarInputsExcetoLogin();
    setInterval(blindarInputsExcetoLogin, 2000);

    setupConnectionMonitoring();
    setupGlobalErrorLogging(db);
});

// =========================================================
// 3. NAVEGAÇÃO E UI
// =========================================================
function setupNavigation() {
    // Menu Mobile Toggle
    safeBind('mobile-menu-btn', 'click', () => {
        const sb = document.getElementById('sidebar-content');
        if(sb) {
            sb.classList.toggle('hidden'); 
            sb.classList.toggle('flex');
        }
    });

    // Links do Menu
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = link.dataset.page;
            
            // TV Mode é especial (Overlay)
            if (pageId === 'tv-mode') {
                startTVMode();
                if(window.innerWidth < 768) document.getElementById('sidebar-content')?.classList.add('hidden');
                return;
            }
            
            changePage(pageId);
        });
    });

    // Logo vai para Início
    safeBind('app-logo-btn', 'click', () => changePage('Inicio'));
    
    // Restaura última página visitada
    const lastPage = localStorage.getItem('appLog_lastPage') || 'dashboard';
    const startPage = document.getElementById(lastPage) ? lastPage : 'dashboard';
    changePage(startPage);
}

function changePage(targetId) {
    // Esconde todas as páginas
    document.querySelectorAll('.page-content').forEach(p => { 
        if(p.id !== 'tv-mode') { 
            p.classList.remove('active'); 
            p.classList.add('hidden'); 
        }
    });

    // Mostra alvo
    const targetEl = document.getElementById(targetId);
    if (targetEl) { 
        targetEl.classList.remove('hidden'); 
        setTimeout(() => targetEl.classList.add('active'), 10);
    }
    
    // Atualiza Menu (Ativo/Inativo)
    document.querySelectorAll('.nav-link').forEach(l => {
        if (l.dataset.page === 'tv-mode') return;
        l.classList.remove('bg-slate-800', 'text-indigo-400', 'border-indigo-500', 'shadow-sm');
        l.classList.add('text-slate-300', 'border-transparent', 'hover:text-white');
    });

    const activeLink = document.querySelector(`[data-page="${targetId}"]`);
    if (activeLink) {
        activeLink.classList.remove('text-slate-300', 'border-transparent', 'hover:text-white');
        activeLink.classList.add('bg-slate-800', 'text-indigo-400', 'border-indigo-500', 'shadow-sm');
    }

    // Salva estado e fecha menu mobile
    localStorage.setItem('appLog_lastPage', targetId);
    if (window.innerWidth < 768) document.getElementById('sidebar-content')?.classList.add('hidden');
}

function setupEnvironmentUI() {
    const badge = document.getElementById('env-badge');
    const strip = document.getElementById('test-mode-strip');
    const warning = document.getElementById('dash-env-warning');
    const logoBg = document.getElementById('logo-bg');
    const switchArea = document.getElementById('env-switch-area');

    // CONFIGURE AQUI OS LINKS REAIS DOS SEUS AMBIENTES
    const URL_PRODUCAO = "https://applog-producao.web.app"; // Coloque o link real
    const URL_TESTE = "https://applog-teste.web.app";       // Coloque o link real (ou localhost)

    if (IS_DEV) {
        // --- ESTAMOS EM MODO TESTE ---
        if(badge) {
            badge.innerText = "Teste";
            badge.className = "text-[10px] uppercase tracking-wider font-bold text-amber-400 bg-amber-900/30 px-1.5 rounded border border-amber-800";
        }
        if(strip) strip.classList.remove('hidden');
        if(warning) warning.classList.remove('hidden');
        if(logoBg) logoBg.classList.add('bg-amber-600');
        
        document.getElementById('test-tools-section')?.classList.remove('hidden');

        // Botão para ir para PRODUÇÃO
        if(switchArea) {
            switchArea.innerHTML = `
                <a href="${URL_PRODUCAO}" class="flex items-center gap-3 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold transition shadow-lg border border-emerald-500/50 group">
                    <div class="bg-white/20 p-1.5 rounded-full group-hover:scale-110 transition-transform">
                        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    </div>
                    Ir para Ambiente de Produção
                </a>
                <p class="text-[10px] text-amber-500/80 mt-3 font-mono">⚠️ Você está no ambiente de TESTES</p>
            `;
        }

    } else {
        // --- ESTAMOS EM PRODUÇÃO ---
        if(badge) {
            badge.innerText = "Produção";
            badge.className = "text-[10px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-900/30 px-1.5 rounded border border-emerald-800";
        }
        if(strip) strip.classList.add('hidden');
        if(warning) warning.classList.add('hidden');
        if(logoBg) logoBg.classList.remove('bg-amber-600');
        
        document.getElementById('test-tools-section')?.classList.add('hidden');

        // Botão para ir para TESTE
        if(switchArea) {
            switchArea.innerHTML = `
                <a href="${URL_TESTE}" class="flex items-center gap-3 px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition shadow-lg border border-amber-500/50 group">
                    <div class="bg-white/20 p-1.5 rounded-full group-hover:scale-110 transition-transform">
                        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>
                    </div>
                    Ir para Ambiente de Testes
                </a>
                <p class="text-[10px] text-emerald-500/80 mt-3 font-mono">🔒 Você está no ambiente de PRODUÇÃO</p>
            `;
        }
    }
}

// =========================================================
// 4. FUNCIONALIDADES DE ESTABILIDADE
// =========================================================

function setupConnectionMonitoring() {
    const banner = document.getElementById('connection-status');
    const updateStatus = () => {
        if (!navigator.onLine) {
            if(banner) banner.classList.remove('hidden');
            document.body.classList.add('offline-mode');
        } else {
            if(banner && !banner.classList.contains('hidden')) {
                banner.innerHTML = `<div class="flex items-center justify-center gap-2"><svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg><span>Conexão Restaurada!</span></div>`;
                banner.classList.replace('bg-red-600', 'bg-emerald-600');
                setTimeout(() => {
                    banner.classList.add('hidden');
                    banner.classList.replace('bg-emerald-600', 'bg-red-600');
                    banner.innerHTML = `<div class="flex items-center justify-center gap-2"><svg class="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"></path></svg><span>Sem Conexão • Modo Offline Ativo</span></div>`;
                }, 3000);
            }
            document.body.classList.remove('offline-mode');
        }
    };
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
}

function setupGlobalErrorLogging(db) {
    const logErrorToFirebase = async (type, errorObj) => {
        if (!navigator.onLine) return; 
        try {
            const errorData = {
                type: type,
                message: errorObj.message || String(errorObj),
                stack: errorObj.stack || 'No stack trace',
                url: window.location.href,
                userAgent: navigator.userAgent,
                timestamp: new Date(),
                user: auth.currentUser ? auth.currentUser.email : 'Anonymous'
            };
            const logsRef = collection(db, 'audit_logs');
            await addDoc(logsRef, {
                action: 'SYSTEM_ERROR',
                target: 'Client Browser',
                user: errorData.user,
                role: 'SYSTEM',
                details: `${type}: ${errorData.message}`,
                createdAt: errorData.timestamp,
                technicalData: errorData
            });
            console.log("🤖 Erro reportado silenciosamente.");
        } catch (loggingError) {
            console.error("Falha ao reportar erro:", loggingError);
        }
    };
    window.addEventListener('error', (event) => {
        if (event.message && event.message.includes('ResizeObserver')) return;
        logErrorToFirebase('JS_EXCEPTION', event.error || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
        logErrorToFirebase('UNHANDLED_PROMISE', event.reason || 'Promise Error');
    });
}

// ✅ FUNÇÃO ATUALIZADA: Bloqueia pop-ups de "Salvar Senha"
function blindarInputsExcetoLogin() {
    const inputs = document.querySelectorAll('input, textarea');
    
    inputs.forEach(el => {
        // 1. Se for o form de Login Principal, ignora (lá queremos que salve)
        if (el.closest('#login-form')) return; 
        
        // Ignora tipos que não salvam dados
        if (el.type === 'radio' || el.type === 'checkbox' || el.type === 'file') return;
        
        // 2. Se já foi processado, ignora
        if (el.dataset.blindado === 'true') return;

        // 3. TÁTICA ANTI-AUTOFILL:
        // 'new-password' força o navegador a não sugerir senhas antigas
        if (el.id.includes('pin') || el.type === 'password') {
            el.setAttribute('autocomplete', 'new-password');
        } else {
            el.setAttribute('autocomplete', 'off');
        }

        // 4. Ignora LastPass e outros gerenciadores
        el.setAttribute('data-lpignore', 'true'); 
        
        // 5. Tática do Readonly (Impede o navegador de focar e sugerir ao carregar a página)
        el.setAttribute('readonly', 'true');
        
        // Remove readonly apenas quando o usuário clica/foca
        el.addEventListener('focus', function() { 
            this.removeAttribute('readonly'); 
        });
        
        // Devolve readonly ao sair (opcional, mas ajuda a manter limpo)
        el.addEventListener('blur', function() { 
            this.setAttribute('readonly', 'true'); 
        });

        // Marca como blindado para não adicionar listeners repetidos
        el.dataset.blindado = 'true';
    });
}