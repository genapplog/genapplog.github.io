/**
 * ARQUIVO: js/modules/auth.js
 * DESCRIÇÃO: Autenticação, Controle de Acesso (RBAC) e Resiliência a Falhas.
 */
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ADMIN_IDS } from '../config.js';
import { showToast, safeBind, copyToClipboard } from '../utils.js';

let currentUser = null;
let currentUserRole = ['OPERADOR']; // ✅ IMPORTANTE: Começa sempre como Array!
let currentUserName = ''; 

const GENERIC_EMAIL = "operador@applog.com"; 

export function initAuth(auth, initialToken, callbackEnv) {
    const db = getFirestore();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            document.getElementById('login-modal').classList.add('hidden');
            await handleUserLoaded(user, db, callbackEnv);
        } else {
            showLoginModal(true);
        }
    });

    setupLoginUI(auth);
}

async function handleUserLoaded(user, db, callbackEnv) {
    currentUser = user;
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
                
                // Normalização robusta de Perfil
                let rawRole = data.role || 'OPERADOR';
                const roleArray = Array.isArray(rawRole) ? rawRole : [rawRole];
                
                currentUserRole = roleArray.map(r => 
                    String(r).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                );

                currentUserName = data.name || '';
                
                // Ajuste de ID para bater com o novo HTML
                const pinField = document.getElementById('account-pin');
                if (pinField) pinField.value = data.pin || '';
            } else {
                // Usuário não existe no banco, mas logou
                currentUserRole = isAdminConfig ? ['ADMIN'] : ['OPERADOR'];
                currentUserName = isAdminConfig ? 'Administrador' : '';
            }
        }
    } catch (e) { 
        // ✅ PROTEÇÃO CONTRA ERRO DE APP CHECK
        console.warn("Aviso: Não foi possível carregar perfil do banco (AppCheck ou Offline). Usando perfil local.", e);
        currentUserRole = isAdminConfig ? ['ADMIN'] : ['OPERADOR']; 
    }

    // Garante Admin do config.js
    if (isAdminConfig && !currentUserRole.includes('ADMIN')) {
        currentUserRole.push('ADMIN');
    }

    // Atualiza UI
    const roleLabel = document.getElementById('user-role-label');
    if(roleLabel) {
        roleLabel.innerText = user.email === GENERIC_EMAIL 
            ? "Operação (Genérico)" 
            : `Logado (${currentUserRole.join(', ')})`;
    }
    
    const btnLogout = document.getElementById('btn-logout');
    if(btnLogout) btnLogout.classList.remove('hidden');

    updateUIForRole(currentUserRole);
    
    const savedEnv = localStorage.getItem('appLog_env') || 'prod';
    if (callbackEnv) callbackEnv(savedEnv);
}

function showLoginModal(forced = false) {
    const modal = document.getElementById('login-modal');
    const btnClose = document.getElementById('btn-close-login');
    if(modal) modal.classList.remove('hidden');
    if (btnClose) btnClose.classList.toggle('hidden', forced);
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

    // ... (O restante das funções de senha e PIN mantêm-se iguais, se quiser posso reenviar, mas o principal é o handleUserLoaded acima)
    setupPinAndPassUI(auth);
}

function setupPinAndPassUI(auth) {
    // 1. Salvar PIN (Novo Layout)
    safeBind('btn-save-pin', 'click', async () => {
        if (!currentUser) return;
        
        const pinInput = document.getElementById('account-pin');
        const btn = document.getElementById('btn-save-pin');
        const pinVal = pinInput.value.trim();

        if (pinVal.length !== 4 || isNaN(pinVal)) {
            showToast("O PIN deve ter 4 números.", "warning");
            return;
        }

        // Feedback Visual no Botão
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
            btn.disabled = false; 
            btn.innerHTML = originalText;
        }
    });

    // 2. Atualizar Senha (Novo Layout)
    safeBind('btn-update-pass', 'click', async () => {
        const currentPass = document.getElementById('account-pass-current').value;
        const newPass = document.getElementById('account-pass-new').value;
        const confirmPass = document.getElementById('account-pass-confirm').value;
        const btn = document.getElementById('btn-update-pass');

        if (!currentPass || !newPass || !confirmPass) {
            showToast("Preencha todos os campos de senha.", "warning");
            return;
        }
        if (newPass.length < 6) return showToast("A nova senha deve ter no mínimo 6 caracteres.", "error");
        if (newPass !== confirmPass) return showToast("A confirmação da senha não confere.", "error");
        if (!currentUser) return;

        btn.disabled = true; btn.innerText = "Validando e Atualizando...";

        try {
            // Reautenticação necessária para operações sensíveis
            const credential = EmailAuthProvider.credential(currentUser.email, currentPass);
            await reauthenticateWithCredential(currentUser, credential);
            
            await updatePassword(currentUser, newPass);
            
            showToast("Senha atualizada com sucesso! Faça login novamente.");
            
            // Limpa campos
            document.getElementById('account-pass-current').value = "";
            document.getElementById('account-pass-new').value = "";
            document.getElementById('account-pass-confirm').value = "";

            // Desloga para forçar novo acesso com segurança
            setTimeout(() => {
                signOut(auth).then(() => window.location.reload());
            }, 2000);

        } catch (error) {
            console.error("Erro Senha:", error);
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
                showToast("Senha atual incorreta.", "error");
            } else {
                showToast("Erro ao atualizar senha. Tente novamente.", "error");
            }
        } finally {
            btn.disabled = false; btn.innerText = "Atualizar Senha de Acesso";
        }
    });
}

function updateUIForRole(roles) {
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
    Object.values(adminEls).forEach(el => { if(el) el.classList[adminAction]('hidden'); });

    const navConfig = document.getElementById('nav-link-config');
    if (navConfig) navConfig.classList.toggle('hidden', !canAccessConfig);

    const navProfile = document.querySelector('a[data-page="perfil"]');
    if (navProfile) navProfile.classList.toggle('hidden', !canAccessConfig);

    const btnAddClient = document.getElementById('add-client-btn');
    if (btnAddClient) btnAddClient.classList.toggle('hidden', !canAccessConfig);
}

export function getUserRole() { return currentUserRole; }
export function getCurrentUserName() { return currentUserName; }
export function checkIsAdmin() { return Array.isArray(currentUserRole) && currentUserRole.includes('ADMIN'); }
export async function updateAccountUI(user) {
    // Função placeholder
    return;
}