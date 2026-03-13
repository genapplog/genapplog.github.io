/**
 * ARQUIVO: js/modules/auth.js
 * DESCRIÇÃO: Autenticação, Controle de Acesso (RBAC) Hierárquico e Segurança de Interface.
 */
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ADMIN_IDS } from '../config.js';
import { showToast, safeBind, copyToClipboard } from '../utils.js';

// --- ESTADO GLOBAL ---
let currentUser = null;
let currentUserRole = ['OPERADOR']; // Padrão seguro
let currentUserName = ''; 
let profileReady = false; // NOVA TRAVA DE SEGURANÇA

const GENERIC_EMAIL = "operador@applog.com"; 

export function initAuth(auth, initialToken, callbackEnv) {
    const db = getFirestore();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            document.getElementById('login-modal')?.classList.add('hidden');
            await handleUserLoaded(user, db, callbackEnv);
        } else {
            showLoginModal(true);
        }
    });

    setupLoginUI(auth);
    setupPinAndPassUI(auth);
}

// --- CARREGAMENTO DE PERFIL ---
async function handleUserLoaded(user, db, callbackEnv) {
    currentUser = user;
    const displayEl = document.getElementById('userIdDisplay');
    if(displayEl) displayEl.innerText = user.email || 'Usuário';

    const isAdminConfig = ADMIN_IDS.includes(user.uid);
    
    try {
        // Busca Perfil no Firestore unificando o tratamento de todos os usuários
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        
        if (userSnap.exists()) {
            const data = userSnap.data();
            
            // Normalização Robusta de Cargos (Array Maiúsculo)
            let rawRole = data.role || 'OPERADOR';
            const roleArray = Array.isArray(rawRole) ? rawRole : [rawRole];
            
            currentUserRole = roleArray.map(r => 
                String(r).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
            );

            currentUserName = data.name || user.email;
            
            // Preenche PIN no formulário de conta (se existir)
            const pinField = document.getElementById('perfil-input-pin');
            if (pinField) pinField.value = data.pin || '';
        } else {
            // Sem cadastro no banco
            currentUserRole = isAdminConfig ? ['ADMIN'] : ['OPERADOR'];
            currentUserName = isAdminConfig ? 'Administrador' : 'Usuário Sem Perfil';
        }
    } catch (e) {
        console.warn("⚠️ Perfil offline ou erro AppCheck. Usando padrão local.", e);
        currentUserRole = isAdminConfig ? ['ADMIN'] : ['OPERADOR']; 
    }

    // Garante Admin Hardcoded
    if (isAdminConfig && !currentUserRole.includes('ADMIN')) {
        currentUserRole.push('ADMIN');
    }

    // Atualiza Label Visual
    const roleLabel = document.getElementById('user-role-label');
    if(roleLabel) {
        roleLabel.innerText = `Logado: ${currentUserName || 'Usuário'} (${currentUserRole.join(', ')})`;
    }
    
    document.getElementById('btn-logout')?.classList.remove('hidden');

    // 🔥 APLICA AS PERMISSÕES NA TELA
    applyPermissions();
    
    // ... (código anterior da função) ...

    // 🔥 APLICA AS PERMISSÕES NA TELA
    applyPermissions();
    
    // Callback de Ambiente (Dev/Prod)
    const savedEnv = localStorage.getItem('appLog_env') || 'prod';
    if (callbackEnv) callbackEnv(savedEnv);

    // ✅ NOVO: AVISA PARA TODO O SISTEMA QUE O PERFIL CARREGOU
    profileReady = true; // Libera a trava
    document.dispatchEvent(new CustomEvent('user-profile-ready'));
}

// Adicione esta nova função exportada no final do arquivo também:
export function isProfileLoaded() {
    return profileReady; // Só retorna true se as permissões já foram processadas
}

// --- A MÁGICA DAS PERMISSÕES (RBAC) ---
function applyPermissions() {
    // 1. Definição de Níveis
    // Nível Gestão: Líder, Inventário ou Admin (Pode ver Dashboard)
    const isGestao = currentUserRole.some(r => ['ADMIN', 'LIDER', 'INVENTARIO'].includes(r));
    
    // 2. Controle de Navegação (Sidebar)
    // Páginas proibidas para Operador Comum
    // Mantém visível apenas: Início, Checklist, Etiquetas, Divergências e TV
    const restrictedPages = ['dashboard', 'configuracoes', 'perfil'];
    
    if (!isGestao) {
        // --- MODO OPERADOR ---
        
        // Esconde links proibidos
        restrictedPages.forEach(page => {
            const el = document.querySelector(`[data-page="${page}"]`);
            if(el) el.classList.add('hidden');
        });

        // Redirecionamento de Segurança:
        // Se estiver no Dashboard ou Configurações, chuta para Etiquetas
        const currentPage = localStorage.getItem('appLog_lastPage');
        if (restrictedPages.includes(currentPage) || !currentPage || currentPage === 'dashboard') {
            console.warn("🚫 Acesso restrito. Redirecionando Operador...");
            const safeTab = document.querySelector('[data-page="etiquetas"]');
            if(safeTab) safeTab.click();
        }

    } else {
        // --- MODO GESTÃO ---
        // Mostra tudo
        restrictedPages.forEach(page => {
            const el = document.querySelector(`[data-page="${page}"]`);
            if(el) el.classList.remove('hidden');
        });
    }

    // 3. Controle Granular de Botões (Via HTML)
    // Procura elementos com data-allowed="ADMIN,LIDER" e decide se mostra
    const protectedElements = document.querySelectorAll('[data-allowed]');
    
    protectedElements.forEach(el => {
        const allowedRoles = el.dataset.allowed.split(',').map(r => r.trim().toUpperCase());
        
        // Verifica se o usuário tem ALGUMA das roles necessárias
        const hasAccess = allowedRoles.some(role => currentUserRole.includes(role));
        
        if (hasAccess) {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });

    // 4. Exceções Legadas (Mantendo compatibilidade com IDs antigos se necessário)
    toggleById('cfg-admin-danger-zone', currentUserRole.includes('ADMIN'));
    toggleById('add-client-btn', isGestao);
}

function toggleById(id, condition) {
    const el = document.getElementById(id);
    if(el) condition ? el.classList.remove('hidden') : el.classList.add('hidden');
}

// --- UI LOGIN ---
function showLoginModal(forced = false) {
    const modal = document.getElementById('login-modal');
    const btnClose = document.getElementById('btn-close-login');
    if(modal) modal.classList.remove('hidden');
    if (btnClose) btnClose.classList.toggle('hidden', forced);
    
    if(forced) document.getElementById('sidebar-content')?.classList.add('hidden');
}

function setupLoginUI(auth) {
    safeBind('btn-open-login', 'click', () => {
        if (currentUser) copyToClipboard(currentUser.uid);
        else showLoginModal(false);
    });

    safeBind('btn-close-login', 'click', (e) => {
        e.preventDefault();
        document.getElementById('login-modal').classList.add('hidden');
        document.getElementById('sidebar-content')?.classList.remove('hidden');
    });

    safeBind('login-form', 'submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-pass').value;
        const btn = document.getElementById('btn-perform-login');
        
        if(btn) { btn.disabled = true; btn.innerText = "Entrando..."; }
        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (error) {
            console.error(error);
            showToast("E-mail ou senha inválidos.", "error");
            if(btn) { btn.disabled = false; btn.innerText = "Entrar"; }
        }
    });

    safeBind('btn-logout', 'click', async () => {
        try { await signOut(auth); window.location.reload(); } catch (e) { console.error(e); }
    });
}

function setupPinAndPassUI(auth) {
    // 1. Salvar PIN
    safeBind('perfil-btn-save-pin', 'click', async () => {
        if (!currentUser) return;
        const pinInput = document.getElementById('perfil-input-pin');
        const btn = document.getElementById('perfil-btn-save-pin');
        const pinVal = pinInput.value.trim();

        if (pinVal.length !== 4 || isNaN(pinVal)) return showToast("O PIN deve ter 4 números.", "warning");

        const originalText = btn.innerHTML;
        btn.disabled = true; 
        btn.innerHTML = `<span class="animate-spin h-4 w-4 border-2 border-white rounded-full border-t-transparent inline-block mr-2"></span>Salvando...`;

        try {
            const db = getFirestore();
            await setDoc(doc(db, 'users', currentUser.uid), { pin: pinVal }, { merge: true });
            showToast("Visto Eletrônico atualizado!", "success");
        } catch (e) {
            console.error(e);
            showToast("Erro ao salvar PIN.", "error");
        } finally {
            btn.disabled = false; btn.innerHTML = originalText;
        }
    });

    // 2. Atualizar Senha
    safeBind('perfil-btn-update-pass', 'click', async () => {
        const currentPass = document.getElementById('perfil-input-pass-current').value;
        const newPass = document.getElementById('perfil-input-pass-new').value;
        const confirmPass = document.getElementById('perfil-input-pass-confirm').value;
        const btn = document.getElementById('perfil-btn-update-pass');

        if (!currentPass || !newPass || !confirmPass) return showToast("Preencha todos os campos.", "warning");
        if (newPass.length < 6) return showToast("Mínimo 6 caracteres.", "error");
        if (newPass !== confirmPass) return showToast("Confirmação incorreta.", "error");
        if (!currentUser) return;

        btn.disabled = true; btn.innerText = "Atualizando...";

        try {
            const credential = EmailAuthProvider.credential(currentUser.email, currentPass);
            await reauthenticateWithCredential(currentUser, credential);
            await updatePassword(currentUser, newPass);
            
            showToast("Senha atualizada! Faça login novamente.");
            setTimeout(() => { signOut(auth).then(() => window.location.reload()); }, 2000);

        } catch (error) {
            console.error("Erro Senha:", error);
            showToast(error.code === 'auth/wrong-password' ? "Senha atual incorreta." : "Erro ao atualizar.", "error");
            btn.disabled = false; btn.innerText = "Atualizar Senha";
        }
    });
}

// --- EXPORTS ---
export function getUserRole() { return currentUserRole; }
export function getCurrentUserName() { return currentUserName; }
export function checkIsAdmin() { return currentUserRole.includes('ADMIN'); }
// Helper para verificar permissão em qualquer lugar do código
export function checkPermission(allowedRoles) {
    if (currentUserRole.includes('ADMIN')) return true; 
    return allowedRoles.some(role => currentUserRole.includes(role));
}