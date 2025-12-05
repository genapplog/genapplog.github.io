/**
 * ARQUIVO: js/modules/auth.js
 * DESCRIÇÃO: Autenticação e Copiar ID.
 */
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ADMIN_IDS } from '../config.js';
// ADICIONADO: Importar copyToClipboard
import { showToast, safeBind, copyToClipboard } from '../utils.js';

let currentUser = null;
let currentUserRole = 'OPERADOR';
let currentUserName = ''; 

const GENERIC_EMAIL = "operador@applog.com"; 

export function initAuth(auth, initialToken, callbackEnv) {
    const db = getFirestore();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            document.getElementById('login-modal').classList.add('hidden');
            handleUserLoaded(user, db, callbackEnv);
        } else {
            showLoginModal(true);
        }
    });

    setupLoginUI(auth);
}

async function handleUserLoaded(user, db, callbackEnv) {
    currentUser = user;
    
    // Atualiza o texto visual
    document.getElementById('userIdDisplay').innerText = user.email || 'Usuário';

    const isAdminConfig = ADMIN_IDS.includes(user.uid);
    
    try {
        if (user.email === GENERIC_EMAIL) {
            currentUserRole = 'OPERADOR';
            currentUserName = ''; 
        } else {
            const userSnap = await getDoc(doc(db, 'users', user.uid));
            if (userSnap.exists()) {
                const data = userSnap.data();
                currentUserRole = data.role ? data.role.toUpperCase() : 'OPERADOR';
                currentUserName = data.name || '';
            } else {
                currentUserRole = isAdminConfig ? 'ADMIN' : 'OPERADOR';
                currentUserName = isAdminConfig ? 'Administrador' : '';
            }
        }
    } catch (e) { console.log(e); }

    if (isAdminConfig) currentUserRole = 'ADMIN';

    const roleLabel = document.getElementById('user-role-label');
    roleLabel.innerText = user.email === GENERIC_EMAIL ? "Operação (Genérico)" : `Logado (${currentUserRole})`;
    
    // Mostra botão de sair
    document.getElementById('btn-logout').classList.remove('hidden');

    updateUIForRole(currentUserRole === 'ADMIN');
    
    const savedEnv = localStorage.getItem('appLog_env') || 'prod';
    if (callbackEnv) callbackEnv(savedEnv);
}

function showLoginModal(forced = false) {
    const modal = document.getElementById('login-modal');
    const btnClose = document.getElementById('btn-close-login');
    
    modal.classList.remove('hidden');
    
    if (forced) {
        btnClose.classList.add('hidden');
    } else {
        btnClose.classList.remove('hidden');
    }
}

function setupLoginUI(auth) {
    // Menu Login/Logout
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
        
        btn.disabled = true; btn.innerText = "Entrando...";
        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (error) {
            console.error(error);
            showToast("E-mail ou senha inválidos.", "error");
            btn.disabled = false; btn.innerText = "Entrar";
        }
    });

    safeBind('btn-logout', 'click', async () => {
        try { await signOut(auth); } catch (e) { console.error(e); }
    });

    // --- NOVA LÓGICA: TROCA DE SENHA ---
    safeBind('form-change-pass', 'submit', async (e) => {
        e.preventDefault();
        const currentPass = document.getElementById('current-pass').value;
        const newPass = document.getElementById('new-pass').value;
        const confirmPass = document.getElementById('confirm-new-pass').value;
        const btn = document.getElementById('btn-save-pass');

        if (newPass.length < 6) return showToast("A nova senha deve ter no mínimo 6 caracteres.", "error");
        if (newPass !== confirmPass) return showToast("A confirmação da senha não confere.", "error");
        if (!currentUser) return showToast("Você precisa estar logado.", "error");

        btn.disabled = true; btn.innerText = "Atualizando...";

        try {
            // 1. Re-autenticar (Segurança do Firebase exige isso para operações sensíveis)
            const credential = EmailAuthProvider.credential(currentUser.email, currentPass);
            await reauthenticateWithCredential(currentUser, credential);

            // 2. Atualizar Senha
            await updatePassword(currentUser, newPass);

            showToast("Senha atualizada com sucesso!");
            document.getElementById('form-change-pass').reset();
            
        } catch (error) {
            console.error(error);
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
                showToast("Senha atual incorreta.", "error");
            } else {
                showToast("Erro ao atualizar senha. Tente novamente.", "error");
            }
        } finally {
            btn.disabled = false; btn.innerText = "Atualizar Senha";
        }
    });
}

function updateUIForRole(isAdmin) {
    const els = { 
        indicator: document.getElementById('admin-indicator'), 
        addBtn: document.getElementById('add-client-btn'), 
        dangerZone: document.getElementById('admin-danger-zone'), 
        navConfig: document.getElementById('nav-link-config') 
    };
    
    const action = isAdmin ? 'remove' : 'add';
    els.indicator.classList[action]('hidden');
    if(els.addBtn) els.addBtn.classList[action]('hidden');
    if(els.dangerZone) els.dangerZone.classList[action]('hidden');
    if (els.navConfig) els.navConfig.classList[action]('hidden');
}

export function getCurrentUser() { return currentUser; }
export function getUserRole() { return currentUserRole; }
export function getCurrentUserName() { return currentUserName; }
export function checkIsAdmin() { return currentUserRole === 'ADMIN'; }