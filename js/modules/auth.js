/**
 * ARQUIVO: js/modules/auth.js
 * DESCRIÇÃO: Autenticação, Controle de Acesso (RBAC) e Copiar ID.
 */
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ADMIN_IDS } from '../config.js';
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

    // ATUALIZADO: Passa o ROLE (string) para a função de UI tratar a granularidade
    updateUIForRole(currentUserRole);
    
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

    // --- LÓGICA: TROCA DE SENHA ---
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

// ATUALIZADO: Função que gerencia a visibilidade baseada no Cargo
function updateUIForRole(role) {
    const isAdmin = role === 'ADMIN';
    // Quem pode ver a aba Configurações? (Admin, Lider, Inventário)
    // Motivo: Todos esses precisam poder trocar o ambiente (Teste/Produção)
    const canAccessConfig = ['ADMIN', 'LIDER', 'INVENTARIO'].includes(role);

    // 1. Elementos exclusivos de ADMIN (Botão adicionar cliente, Zonas de perigo, Seções de gestão)
    const adminEls = { 
        indicator: document.getElementById('admin-indicator'), 
        addBtn: document.getElementById('add-client-btn'), 
        dangerZone: document.getElementById('admin-danger-zone'),
        // Seções internas da tela de Configuração (Adicionadas via ID no HTML)
        cfgClients: document.getElementById('cfg-section-clients'),
        cfgTeam: document.getElementById('cfg-section-team'),
        cfgProds: document.getElementById('cfg-section-products')
    };
    
    // Se for Admin, remove a classe 'hidden'. Se não for, adiciona 'hidden'.
    const adminAction = isAdmin ? 'remove' : 'add';
    
    if (adminEls.indicator) adminEls.indicator.classList[adminAction]('hidden');
    if (adminEls.addBtn) adminEls.addBtn.classList[adminAction]('hidden');
    if (adminEls.dangerZone) adminEls.dangerZone.classList[adminAction]('hidden');
    
    // Esconde/Mostra os blocos de gestão dentro da aba Configurações
    if (adminEls.cfgClients) adminEls.cfgClients.classList[adminAction]('hidden');
    if (adminEls.cfgTeam) adminEls.cfgTeam.classList[adminAction]('hidden');
    if (adminEls.cfgProds) adminEls.cfgProds.classList[adminAction]('hidden');

    // 2. Elementos de Gestão (Acesso à aba Configurações no menu lateral)
    const navConfig = document.getElementById('nav-link-config');
    if (navConfig) {
        if (canAccessConfig) navConfig.classList.remove('hidden');
        else navConfig.classList.add('hidden');
    }
}

export function getCurrentUser() { return currentUser; }
export function getUserRole() { return currentUserRole; }
export function getCurrentUserName() { return currentUserName; }
export function checkIsAdmin() { return currentUserRole === 'ADMIN'; }