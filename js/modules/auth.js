/**
 * ARQUIVO: js/modules/auth.js
 * DESCRIÇÃO: Autenticação, Controle de Acesso (RBAC) e Copiar ID.
 */
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ADMIN_IDS } from '../config.js';
import { showToast, safeBind, copyToClipboard } from '../utils.js';

let currentUser = null;
// CORREÇÃO: Inicializa SEMPRE como array para evitar erros de .includes() ou .some()
let currentUserRole = ['OPERADOR']; 
let currentUserName = ''; 

const GENERIC_EMAIL = "operador@applog.com"; 

export function initAuth(auth, initialToken, callbackEnv) {
    const db = getFirestore();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            document.getElementById('login-modal').classList.add('hidden');
            // Chama a função de carga de usuário
            await handleUserLoaded(user, db, callbackEnv);
        } else {
            showLoginModal(true);
        }
    });

    setupLoginUI(auth);
}

async function handleUserLoaded(user, db, callbackEnv) {
    currentUser = user;
    
    // Atualiza o texto visual
    const displayEl = document.getElementById('userIdDisplay');
    if(displayEl) displayEl.innerText = user.email || 'Usuário';

    const isAdminConfig = ADMIN_IDS.includes(user.uid);
    
    try {
        if (user.email === GENERIC_EMAIL) {
            currentUserRole = ['OPERADOR'];
            currentUserName = ''; 
        } else {
            // Tenta ler do banco
            const userSnap = await getDoc(doc(db, 'users', user.uid));
            
            if (userSnap.exists()) {
                const data = userSnap.data();
                
                // --- LÓGICA DE NORMALIZAÇÃO ---
                let rawRole = data.role || 'OPERADOR';
                
                // Garante que é Array (ex: "Lider" vira ["Lider"])
                const roleArray = Array.isArray(rawRole) ? rawRole : [rawRole];
                
                // Converte para Maiúsculo e Remove Acentos (ex: "Inventário" -> "INVENTARIO")
                currentUserRole = roleArray.map(r => 
                    String(r).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                );

                currentUserName = data.name || '';
                
                // Carrega PIN
                const pinField = document.getElementById('profile-pin');
                if (pinField) pinField.value = data.pin || '';
            } else {
                // Usuário não existe no banco, usa fallback do config
                currentUserRole = isAdminConfig ? ['ADMIN'] : ['OPERADOR'];
                currentUserName = isAdminConfig ? 'Administrador' : '';
            }
        }
    } catch (e) { 
        console.error("ALERTA: Falha ao ler perfil (Possível bloqueio AppCheck):", e);
        // Em caso de erro (AppCheck bloqueando), usa o config local como fallback
        currentUserRole = isAdminConfig ? ['ADMIN'] : ['OPERADOR'];
        if(isAdminConfig) showToast("Acesso Admin (Modo Offline/Config)", "warning");
    }

    // GARANTIA FINAL: Se estiver no config.js como Admin, adiciona o papel ADMIN na marra
    if (isAdminConfig && !currentUserRole.includes('ADMIN')) {
        currentUserRole.push('ADMIN');
    }

    // Atualiza Interface Visual
    const roleLabel = document.getElementById('user-role-label');
    if(roleLabel) {
        roleLabel.innerText = user.email === GENERIC_EMAIL 
            ? "Operação (Genérico)" 
            : `Logado (${currentUserRole.join(', ')})`;
    }
    
    const btnLogout = document.getElementById('btn-logout');
    if(btnLogout) btnLogout.classList.remove('hidden');

    // Aplica permissões na tela
    updateUIForRole(currentUserRole);
    
    const savedEnv = localStorage.getItem('appLog_env') || 'prod';
    if (callbackEnv) callbackEnv(savedEnv);
}

function showLoginModal(forced = false) {
    const modal = document.getElementById('login-modal');
    const btnClose = document.getElementById('btn-close-login');
    
    if(modal) modal.classList.remove('hidden');
    
    if (btnClose) {
        if (forced) btnClose.classList.add('hidden');
        else btnClose.classList.remove('hidden');
    }
}

function setupLoginUI(auth) {
    safeBind('btn-open-login', 'click', () => {
        if (currentUser) copyToClipboard(currentUser.uid);
        else showLoginModal(false);
    });

    safeBind('btn-close-login', 'click', (e) => {
        e.preventDefault();
        document.getElementById('login-modal').classList.add('hidden');
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
        try { await signOut(auth); } catch (e) { console.error(e); }
    });

    safeBind('form-change-pass', 'submit', async (e) => {
        e.preventDefault();
        const currentPass = document.getElementById('current-pass').value;
        const newPass = document.getElementById('new-pass').value;
        const confirmPass = document.getElementById('confirm-new-pass').value;
        const btn = document.getElementById('btn-save-pass');

        if (newPass.length < 6) return showToast("A nova senha deve ter no mínimo 6 caracteres.", "error");
        if (newPass !== confirmPass) return showToast("A confirmação da senha não confere.", "error");
        if (!currentUser) return showToast("Você precisa estar logado.", "error");

        if(btn) { btn.disabled = true; btn.innerText = "Atualizando..."; }

        try {
            const credential = EmailAuthProvider.credential(currentUser.email, currentPass);
            await reauthenticateWithCredential(currentUser, credential);
            await updatePassword(currentUser, newPass);
            showToast("Senha atualizada com sucesso!");
            document.getElementById('form-change-pass').reset();
        } catch (error) {
            console.error(error);
            showToast("Erro ao atualizar senha.", "error");
        } finally {
            if(btn) { btn.disabled = false; btn.innerText = "Atualizar Senha"; }
        }
    });

    safeBind('btn-save-pin', 'click', async () => {
        if (!currentUser) return;
        const pinVal = document.getElementById('profile-pin').value.trim();
        const btn = document.getElementById('btn-save-pin');

        if (pinVal.length < 4) return showToast("O PIN deve ter no mínimo 4 dígitos.", "error");

        if(btn) { btn.disabled = true; btn.innerText = "..."; }
        try {
            const db = getFirestore();
            await setDoc(doc(db, 'users', currentUser.uid), { pin: pinVal }, { merge: true });
            showToast("PIN salvo!");
        } catch (e) {
            console.error(e);
            showToast("Erro ao salvar PIN.", "error");
        } finally {
            if(btn) { btn.disabled = false; btn.innerText = "Salvar PIN"; }
        }
    });
}

// CORREÇÃO: Função preparada para receber Array
function updateUIForRole(roles) {
    // Se roles for nulo ou indefinido, usa array vazio
    const safeRoles = Array.isArray(roles) ? roles : [];
    
    const isAdmin = safeRoles.includes('ADMIN');
    const canAccessConfig = safeRoles.some(r => ['ADMIN', 'LIDER', 'INVENTARIO'].includes(r));

    const adminEls = {
        indicator: document.getElementById('admin-indicator'), 
        dangerZone: document.getElementById('admin-danger-zone'),
        cfgClients: document.getElementById('cfg-section-clients'),
        cfgTeam: document.getElementById('cfg-section-team'),
        cfgProds: document.getElementById('cfg-section-products')
    };
    
    const adminAction = isAdmin ? 'remove' : 'add';
    
    if (adminEls.indicator) adminEls.indicator.classList[adminAction]('hidden');
    if (adminEls.dangerZone) adminEls.dangerZone.classList[adminAction]('hidden');
    if (adminEls.cfgClients) adminEls.cfgClients.classList[adminAction]('hidden');
    if (adminEls.cfgTeam) adminEls.cfgTeam.classList[adminAction]('hidden');
    if (adminEls.cfgProds) adminEls.cfgProds.classList[adminAction]('hidden');

    const navConfig = document.getElementById('nav-link-config');
    if (navConfig) {
        if (canAccessConfig) navConfig.classList.remove('hidden');
        else navConfig.classList.add('hidden');
    }

    const navProfile = document.querySelector('a[data-page="perfil"]');
    if (navProfile) {
        if (canAccessConfig) navProfile.classList.remove('hidden');
        else navProfile.classList.add('hidden');
    }

    const btnAddClient = document.getElementById('add-client-btn');
    if (btnAddClient) {
        if (canAccessConfig) btnAddClient.classList.remove('hidden');
        else btnAddClient.classList.add('hidden');
    }
}

export function getCurrentUser() { return currentUser; }
export function getUserRole() { return currentUserRole; }
export function getCurrentUserName() { return currentUserName; }
export function checkIsAdmin() { return Array.isArray(currentUserRole) && currentUserRole.includes('ADMIN'); }