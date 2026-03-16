/**
 * ARQUIVO: js/app.js
 * DESCRIÇÃO: Ponto de entrada da aplicação (Router, Init, Segurança).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";
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
import { loadViews } from './services/view-loader.js';
import { initAuth } from './modules/auth.js';
import { initLabelsModule } from './modules/labels.js';
import { initClientsModule, refreshClientList } from './modules/clients.js';
import { initRncModule } from './modules/rnc.js';
import { initAdminModule } from './modules/admin.js';
import { initDashboard, startTVMode } from './modules/dashboard.js';
import { initAgendamentoModule } from './modules/agendamento.js'; // Novo Módulo
import { initCadastrosModule } from './modules/cadastros.js';
import { syncProductsCache } from './modules/product-cache.js'; // ✅ Importa o motor de cache

// =========================================================
// 1. INICIALIZAÇÃO FIREBASE (CORE)
// =========================================================
const app = initializeApp(firebaseConfig);

// ✅ LÓGICA DO APP CHECK: Desativa em Localhost (IS_DEV)
if (!IS_DEV) {
    try {
        // Usa o provedor Enterprise (Padrão atual do Firebase)
        initializeAppCheck(app, {
            provider: new ReCaptchaEnterpriseProvider('6LewvygsAAAAAFh2REyS-NyO3FI9KG6J0SjfrIoz'),
            isTokenAutoRefreshEnabled: true
        });
        console.log("🛡️ App Check ativado (Produção - Enterprise).");
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

// O ViewLoader agora é importado externamente de js/services/view-loader.js

document.addEventListener('DOMContentLoaded', async () => {
    console.log(`🚀 AppLog Iniciando... Ambiente: ${IS_DEV ? 'DESENVOLVIMENTO' : 'PRODUÇÃO'}`);

    // 1. Carrega toda a interface HTML separada ANTES de rodar os scripts
    await loadViews();

    // Configurações Iniciais
    setupEnvironmentUI();
    setupNavigation();
    
    // Inicia Módulos Independentes
    initLabelsModule();
    initAuth(auth);

    // Inicia Módulos Conectados ao DB
    const clientsCollection = collection(db, PATHS.clients);

    // ✅ CORREÇÃO: Inicia os módulos APENAS após confirmar a autenticação
    let modulesInitialized = false;

    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log("🔓 Usuário autenticado: " + user.email);
            
            // Evita reinicializar os módulos se o auth state mudar (ex: token refresh)
            if (!modulesInitialized) {
                console.log("🚀 Sistema Autenticado. Aguardando interação do usuário para carregar dados...");
                
                // Módulos leves e invisíveis que podem rodar em background
                syncProductsCache(db); 
                
                modulesInitialized = true;

                // 🚨 OTIMIZAÇÃO CRÍTICA: Dispara o módulo apenas da página atual que foi restaurada do localStorage
                const currentPage = localStorage.getItem('appLog_lastPage') || 'dashboard';
                dispatchModuleInit(currentPage); 
            }

            // Atualização de permissões admin e Segurança de Menus
                setTimeout(() => {
                    console.log("🔄 Atualizando interface e permissões...");
                    refreshClientList();
                    
                    // Como já temos acesso às funções de auth neste arquivo (importadas no topo),
                    // não precisamos fazer um import dinâmico aqui. Basta chamá-la direto.
                    import('./modules/auth.js').then(authModule => { // ⬅️ Manteremos o then por compatibilidade da promise, mas o Vite resolve no root
                        const roles = authModule.getUserRole() || [];
                        const isGestao = roles.some(r => ['ADMIN', 'LIDER', 'INVENTARIO'].includes(r));
                    const isAdmin = roles.includes('ADMIN');
                    const isLider = roles.includes('LIDER');
                    const isInventario = roles.includes('INVENTARIO');

                    if (isGestao) {
                        ativarNotificacoesGestao();
                    }

                    // PROTEÇÃO DE TELA: Oculta links restritos do menu lateral
                    document.querySelectorAll('.nav-link[data-allowed]').forEach(link => {
                        const allowedRoles = link.dataset.allowed.split(',');
                        // Se o usuário tem algum dos papeis permitidos, mostra o link
                        const canSee = allowedRoles.some(role => roles.includes(role));
                        if (canSee) {
                            link.classList.remove('hidden');
                        } else {
                            link.classList.add('hidden');
                        }
                    });
                });
            }, 1000);
            
        } else {
            console.log("🔒 Usuário não autenticado. Dados protegidos.");
            // Aqui você poderia limpar a tela ou redirecionar para login se necessário
            modulesInitialized = false;
        }
    });

    // Funcionalidades Globais de Estabilidade
    blindarInputsExcetoLogin();
    
    // A blindagem de inputs é acionada estritamente após o carregamento das views
    document.addEventListener('views-loaded', () => blindarInputsExcetoLogin());

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

// Memória dos módulos já acordados para não baixar os dados duas vezes na mesma sessão
const activeModules = new Set();

function dispatchModuleInit(pageId) {
    if (activeModules.has(pageId)) return; // Já foi carregado
    
    console.log(`⚡ Despertando módulo sob demanda: ${pageId}`);
    
    // As coleções precisam estar acessíveis aqui (O db é global no app.js)
    const dbRef = db; 
    const clientsRef = collection(dbRef, PATHS.clients);

    try {
        switch (pageId) {
            case 'clientes':
                initClientsModule(clientsRef);
                break;
            case 'ocorrencias':
                initRncModule(dbRef, IS_DEV);
                break;
            case 'dashboard':
                initDashboard(dbRef); // Garanta que initDashboard esteja importado no topo do app.js
                break;
            case 'cadastros':
                initCadastrosModule(dbRef);
                break;
            case 'agendamento':
                initAgendamentoModule(dbRef);
                break;
            case 'configuracoes':
                initAdminModule(dbRef, clientsRef);
                break;
        }
        activeModules.add(pageId); // Marca como acordado
    } catch (e) {
        console.error(`Erro ao iniciar módulo ${pageId}:`, e);
    }
}

function changePage(targetId) {
    // 🚨 Acorda o banco de dados apenas da aba solicitada
    dispatchModuleInit(targetId);

    // Esconde todas as páginas
    document.querySelectorAll('.page-content').forEach(p => {
        if(p.id !== 'tv-mode') { 
            p.classList.remove('active'); 
            p.classList.add('hidden'); 
        }
    });

    // 3. Mostra alvo
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

    // ✅ LINKS REAIS CONFIGURADOS
    const URL_PRODUCAO = "https://applog.app.br"; 
    const URL_TESTE = "https://teste.applog.app.br";       

    if (IS_DEV) {
        // --- ESTAMOS EM MODO TESTE (Subdomínio) ---
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
        // --- ESTAMOS EM PRODUÇÃO (Domínio Principal) ---
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
async function ativarNotificacoesGestao() {
    if (!("Notification" in window)) return;

    if (Notification.permission === "default") {
        console.log("🔔 Solicitando permissão de notificação para Gestão...");
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            showToast("Notificações ativadas com sucesso!", "success");
        }
    }
    
    // Registrar Token de Push (FCM)
    // Se você usa Firebase Cloud Messaging, aqui deve entrar o código de getToken()
}