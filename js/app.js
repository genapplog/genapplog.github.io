/**
 * ARQUIVO: js/app.js
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager,
    collection,
    addDoc // Importado para o Log de Erros
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { firebaseConfig, PATHS, IS_DEV } from './config.js';

import { safeBind, showToast } from './utils.js'; // Adicionei showToast aqui
import { initAuth } from './modules/auth.js';
import { initLabelsModule } from './modules/labels.js';
import { initClientsModule } from './modules/clients.js';
import { initRncModule } from './modules/rnc.js';
import { initAdminModule } from './modules/admin.js';
import { initDashboard, startTVMode } from './modules/dashboard.js';

const app = initializeApp(firebaseConfig);

// Inicialização do App Check
try {
    initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider('6LcIwEosAAAAAO2Ph6II8msIeZnBa9wr6JV3Kut7'),
        isTokenAutoRefreshEnabled: true
    });
} catch (e) {
    console.warn("Aviso App Check:", e);
}

const auth = getAuth(app);

// Inicialização do Banco com Cache Offline (PWA)
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    })
});

function setupNavigation() {
    safeBind('mobile-menu-btn', 'click', () => {
        const sb = document.getElementById('sidebar-content');
        sb.classList.toggle('hidden'); sb.classList.toggle('flex');
    });
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            changePage(link.dataset.page);
        });
    });
    safeBind('app-logo-btn', 'click', () => changePage('Inicio'));
    
    const lastPage = localStorage.getItem('appLog_lastPage') || 'dashboard';
    changePage(document.getElementById(lastPage) ? lastPage : 'dashboard');
}

function changePage(target) {
    if (target === 'tv-mode') {
        startTVMode();
        return;
    }

    localStorage.setItem('appLog_lastPage', target);
    document.querySelectorAll('.page-content').forEach(p => { 
        if(p.id !== 'tv-mode') {
            p.classList.remove('active'); 
            p.classList.add('hidden'); 
        }
    });
    const targetEl = document.getElementById(target);
    if (targetEl) { targetEl.classList.remove('hidden'); targetEl.classList.add('active'); }
    
    document.querySelectorAll('.nav-link').forEach(l => {
        if (l.dataset.page === 'tv-mode') return;
        l.classList.remove('bg-slate-800', 'text-indigo-400', 'border-indigo-500', 'shadow-sm');
        l.classList.add('text-slate-300', 'border-transparent', 'hover:text-white');
    });
    const activeLink = document.querySelector(`[data-page="${target}"]`);
    if (activeLink && target !== 'tv-mode') {
        activeLink.classList.remove('text-slate-300', 'border-transparent', 'hover:text-white');
        activeLink.classList.add('bg-slate-800', 'text-indigo-400', 'border-indigo-500', 'shadow-sm');
    }
    if (window.innerWidth < 768) document.getElementById('sidebar-content').classList.add('hidden');
}

function setupEnvironment() {
    const badge = document.getElementById('env-badge');
    
    if (badge) {
        badge.innerText = IS_DEV ? "Teste" : "Produção";
        badge.className = IS_DEV 
            ? "text-[10px] uppercase tracking-wider font-bold text-amber-400 bg-amber-900/30 px-1.5 rounded border border-amber-800" 
            : "text-[10px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-900/30 px-1.5 rounded border border-emerald-800";
    }
    
    if (IS_DEV) {
        document.getElementById('test-mode-strip')?.classList.remove('hidden');
        document.getElementById('test-mode-bg-indicator')?.classList.remove('hidden');
        document.getElementById('dash-env-warning')?.classList.remove('hidden');
        document.getElementById('logo-bg')?.classList.add('bg-amber-600');
        console.log("🛠️ App rodando em modo DESENVOLVIMENTO");
    } else {
        document.getElementById('test-mode-strip')?.classList.add('hidden');
        document.getElementById('test-mode-bg-indicator')?.classList.add('hidden');
        document.getElementById('test-tools-section')?.classList.add('hidden');
        document.getElementById('dash-env-warning')?.classList.add('hidden');
        document.getElementById('logo-bg')?.classList.remove('bg-amber-600');
    }

    const toggleBtn = document.getElementById('env-toggle');
    if(toggleBtn) {
        const toggleContainer = toggleBtn.closest('label') || toggleBtn.parentElement;
        if(toggleContainer) toggleContainer.style.display = 'none';
    }

    const clientsCollection = collection(db, PATHS.clients);
    
    initClientsModule(clientsCollection);
    initRncModule(db, IS_DEV);
    initAdminModule(db, clientsCollection);
}

// --- OPÇÃO 2: MONITORAMENTO DE CONEXÃO ---
function setupConnectionMonitoring() {
    const banner = document.getElementById('connection-status');
    
    const updateStatus = () => {
        if (!navigator.onLine) {
            // OFFLINE
            if(banner) banner.classList.remove('hidden');
            document.body.classList.add('offline-mode');
        } else {
            // ONLINE
            if(banner) {
                // Pequeno delay para evitar piscar em oscilações rápidas
                banner.innerHTML = `
                    <div class="flex items-center justify-center gap-2">
                        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                        <span>Conexão Restaurada!</span>
                    </div>
                `;
                banner.classList.remove('bg-red-600');
                banner.classList.add('bg-emerald-600');
                
                setTimeout(() => {
                    banner.classList.add('hidden');
                    banner.classList.remove('bg-emerald-600');
                    banner.classList.add('bg-red-600');
                    // Restaura texto original
                    banner.innerHTML = `
                        <div class="flex items-center justify-center gap-2">
                            <svg class="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"></path></svg>
                            <span>Sem Conexão • Modo Offline Ativo</span>
                        </div>
                    `;
                }, 3000);
            }
            document.body.classList.remove('offline-mode');
        }
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    
    // Verifica status inicial
    updateStatus();
}

// --- OPÇÃO 3: LOG DE ERROS AUTOMÁTICO ---
function setupGlobalErrorLogging(db) {
    const logErrorToFirebase = async (type, errorObj) => {
        // Evita loop infinito se o erro for de conexão ou do próprio Firebase
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

            // Salva na mesma coleção de logs, com tipo SYSTEM_ERROR
            // Usamos addDoc direto para não depender do admin.js carregar
            const logsRef = collection(db, 'audit_logs');
            await addDoc(logsRef, {
                action: 'SYSTEM_ERROR',
                target: 'AppLog Client',
                user: errorData.user,
                role: 'SYSTEM',
                details: `${type}: ${errorData.message}`,
                createdAt: errorData.timestamp,
                technicalData: errorData // Guarda o stack trace completo
            });
            
            console.log("🤖 Erro reportado ao servidor com sucesso.");
        } catch (loggingError) {
            // Se falhar o log, apenas imprime no console para não travar o usuário
            console.error("Falha ao enviar log de erro:", loggingError);
        }
    };

    // 1. Captura erros de JavaScript (Crash de código)
    window.addEventListener('error', (event) => {
        // Ignora erros de redimensionamento do ResizeObserver (são inofensivos e comuns)
        if (event.message && event.message.includes('ResizeObserver')) return;
        
        logErrorToFirebase('JS_EXCEPTION', event.error || event.message);
    });

    // 2. Captura erros de Promessas (Ex: Falha de rede, Firebase rejeitado)
    window.addEventListener('unhandledrejection', (event) => {
        logErrorToFirebase('UNHANDLED_PROMISE', event.reason || 'Unknown Promise Error');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    initLabelsModule();
    initAuth(auth); 
    setupEnvironment();
    blindarInputsExcetoLogin();

    // Inicia as novas funcionalidades de confiabilidade
    setupConnectionMonitoring();
    setupGlobalErrorLogging(db);
});

function blindarInputsExcetoLogin() {
    const inputs = document.querySelectorAll('input, textarea');
    inputs.forEach(el => {
        if (el.closest('#login-form')) return;
        if (el.type === 'radio' || el.type === 'checkbox') return;
        if (el.name && el.name.includes('no_autofill')) return;

        const randomName = 'field_' + Math.random().toString(36).substring(7);
        el.setAttribute('name', randomName);
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('data-lpignore', 'true'); 
        el.setAttribute('readonly', 'true');

        el.addEventListener('focus', function() { this.removeAttribute('readonly'); });
        el.addEventListener('blur', function() { this.setAttribute('readonly', 'true'); });
    });
}