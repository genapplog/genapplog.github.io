/**
 * ARQUIVO: js/modules/cadastros.js
 * DESCRIÇÃO: Gestão individual de Produtos e Equipe (Adicionar, Buscar, Excluir).
 */

import { 
    doc, 
    setDoc, 
    deleteDoc, 
    collection, 
    query, 
    getDocs, 
    onSnapshot,
    getDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { safeBind, showToast, openConfirmModal, closeConfirmModal } from '../utils.js';
import { registerLog } from './admin.js';
import { getUserRole } from './auth.js'; // Importando para checar quem está salvando

let dbInstance = null;
let currentUsersList = [];

export function initCadastrosModule(db) {
    console.log("Iniciando Módulo de Cadastros Manuais...");
    dbInstance = db;

    setupTabs();
    setupProductForm();
    setupProductSearchUI();
    setupUserForm();
    listenToUsers();
    
    // Oculta a option Admin para Líderes
    setTimeout(() => {
        const roles = getUserRole() || [];
        if (!roles.includes('ADMIN')) {
            const adminOption = document.querySelector('#cad-user-role option[value="ADMIN"]');
            if (adminOption) adminOption.disabled = true;
        }
    }, 1000);
}

// =========================================================
// NAVEGAÇÃO DAS ABAS
// =========================================================
function setupTabs() {
    const btnProd = document.getElementById('tab-btn-produtos');
    const btnEquipe = document.getElementById('tab-btn-equipe');
    const tabProd = document.getElementById('tab-produtos');
    const tabEquipe = document.getElementById('tab-equipe');

    if (!btnProd || !btnEquipe) return;

    safeBind('tab-btn-produtos', 'click', () => {
        // Estilo da Aba
        btnProd.classList.replace('border-transparent', 'border-indigo-500');
        btnProd.classList.replace('text-slate-500', 'text-indigo-400');
        btnEquipe.classList.replace('border-indigo-500', 'border-transparent');
        btnEquipe.classList.replace('text-emerald-400', 'text-slate-500');
        
        // Telas
        tabProd.classList.remove('hidden');
        tabEquipe.classList.add('hidden');
    });

    safeBind('tab-btn-equipe', 'click', () => {
        // Estilo da Aba (Usando emerald para diferenciar Equipe)
        btnEquipe.classList.replace('border-transparent', 'border-indigo-500');
        btnEquipe.classList.replace('text-slate-500', 'text-emerald-400');
        btnProd.classList.replace('border-indigo-500', 'border-transparent');
        btnProd.classList.replace('text-indigo-400', 'text-slate-500');
        
        // Telas
        tabEquipe.classList.remove('hidden');
        tabProd.classList.add('hidden');
    });
}

// =========================================================
// ABA PRODUTOS
// =========================================================
function setupProductForm() {
    safeBind('form-cad-produto', 'submit', async (e) => {
        e.preventDefault();
        const dunInput = document.getElementById('cad-prod-dun');
        const codInput = document.getElementById('cad-prod-cod');
        const descInput = document.getElementById('cad-prod-desc');
        const btn = document.getElementById('btn-salvar-produto');

        // Limpa formatação (ex: letras no código de barras)
        const cleanDun = dunInput.value.replace(/\D/g, ''); 
        const codigo = codInput.value.trim();
        const descricao = descInput.value.toUpperCase().trim();

        if (cleanDun.length < 8) return showToast("DUN inválido.", "warning");

        const originalText = btn.innerText;
        btn.disabled = true; btn.innerText = "Salvando...";

        try {
            await setDoc(doc(dbInstance, 'products', cleanDun), { 
                codigo: codigo, 
                descricao: descricao,
                updatedAt: new Date() 
            });
            showToast("Produto salvo com sucesso!", "success");
            registerLog('CAD_PRODUTO', cleanDun, `Cadastrou/Editou produto: ${descricao}`);
            
            // Limpa o formulário
            dunInput.value = ''; codInput.value = ''; descInput.value = '';
            dunInput.focus();

        } catch (error) {
            console.error(error);
            showToast("Erro ao salvar produto.", "error");
        } finally {
            btn.disabled = false; btn.innerText = originalText;
        }
    });
}

function setupProductSearchUI() {
    const container = document.getElementById('cadastros-busca-produto-container');
    if (!container) return;

    // Injeta a interface de busca dinamicamente para não sujar o HTML principal
    container.innerHTML = `
        <div class="bg-slate-900 p-4 rounded-lg border border-slate-700">
            <div class="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
                <h4 class="text-sm font-bold text-white uppercase">Consultar Produtos</h4>
                <div class="flex gap-2 w-full md:w-auto">
                    <input type="text" id="cad-busca-prod-input" placeholder="Digite DUN, Cód ou Descrição..." class="w-full md:w-64 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs text-white focus:border-indigo-500 outline-none">
                    <button id="cad-btn-buscar-prod" class="bg-indigo-900/30 text-indigo-400 hover:bg-indigo-600 hover:text-white border border-indigo-500/30 px-4 py-2 rounded transition font-bold text-xs">Buscar</button>
                </div>
            </div>
            <div class="overflow-hidden rounded border border-slate-700">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-950 text-slate-400 font-medium">
                        <tr><th class="p-3">DUN</th><th class="p-3">Descrição & Código</th><th class="p-3 text-right">Ação</th></tr>
                    </thead>
                    <tbody id="cad-tbody-prod-list" class="divide-y divide-slate-800 text-slate-300">
                        <tr><td colspan="3" class="p-4 text-center italic text-slate-500">Utilize a busca acima.</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const inputSearch = document.getElementById('cad-busca-prod-input');
    const btnSearch = document.getElementById('cad-btn-buscar-prod');
    const tbody = document.getElementById('cad-tbody-prod-list');

    const doSearch = async () => {
        const term = inputSearch.value.toUpperCase().trim();
        if (term.length < 3) return showToast("Digite no mínimo 3 caracteres.", "info");
        
        tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-indigo-400"><span class="animate-pulse">Buscando no servidor...</span></td></tr>';

        try {
            const productsRef = collection(dbInstance, 'products');
            let results = [];
            
            // Busca direta por ID se for só número (Mais rápido)
            if (/^\d+$/.test(term)) {
                const docSnap = await getDoc(doc(dbInstance, 'products', term));
                if (docSnap.exists()) results.push({ id: docSnap.id, ...docSnap.data() });
            }
            
            // Se não achou por ID exato, varre (Limitado aos 15 primeiros para performance)
            if (results.length === 0) {
                const q = query(productsRef); 
                const querySnapshot = await getDocs(q);
                for (const doc of querySnapshot.docs) {
                    const d = doc.data();
                    if (doc.id.includes(term) || d.descricao.includes(term) || d.codigo.includes(term)) {
                        results.push({ id: doc.id, ...d });
                        if (results.length >= 15) break; // Trava de performance
                    }
                }
            }
            
            renderProdTable(results);
            
        } catch (e) { 
            console.error(e); 
            tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-red-400">Erro na busca.</td></tr>'; 
        }
    };

    const renderProdTable = (items) => {
        tbody.innerHTML = '';
        if (items.length === 0) { 
            tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center italic text-slate-500">Nenhum produto encontrado.</td></tr>'; 
            return; 
        }
        
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-800/50 transition-colors";
            
            const tdId = document.createElement('td'); 
            tdId.className = "p-3 font-mono text-indigo-300 font-bold tracking-wider"; 
            tdId.textContent = item.id;
            
            const tdDesc = document.createElement('td'); 
            tdDesc.className = "p-3";
            tdDesc.innerHTML = `<div class="font-bold text-white">${item.descricao}</div><div class="text-[10px] text-slate-400 font-mono">SAP: ${item.codigo}</div>`;

            const tdAct = document.createElement('td'); 
            tdAct.className = "p-3 text-right";
            
            const btnDel = document.createElement('button'); 
            btnDel.className = "text-red-400 hover:text-white bg-red-900/20 hover:bg-red-600 p-2 rounded transition";
            btnDel.title = "Excluir Produto";
            btnDel.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
            
            btnDel.onclick = () => {
                openConfirmModal("Excluir Produto?", `DUN: ${item.id} - ${item.descricao}`, async () => {
                    try {
                        await deleteDoc(doc(dbInstance, 'products', item.id));
                        showToast("Produto excluído.");
                        closeConfirmModal();
                        doSearch(); // Recarrega
                        registerLog('DEL_PRODUTO', item.id, 'Produto excluído manualmente');
                    } catch(err) { showToast("Erro ao excluir", "error"); }
                });
            };

            tdAct.appendChild(btnDel);
            tr.append(tdId, tdDesc, tdAct);
            tbody.appendChild(tr);
        });
    };

    safeBind('cad-btn-buscar-prod', 'click', doSearch);
    if(inputSearch) inputSearch.addEventListener('keypress', (e) => { if(e.key === 'Enter') doSearch(); });
}

// =========================================================
// ABA EQUIPE (USUÁRIOS)
// =========================================================
function setupUserForm() {
    safeBind('form-cad-user', 'submit', async (e) => {
        e.preventDefault();
        const idInput = document.getElementById('cad-user-id');
        const nomeInput = document.getElementById('cad-user-nome');
        const roleInput = document.getElementById('cad-user-role');
        const btn = document.getElementById('btn-salvar-user');

        const uid = idInput.value.trim().toLowerCase(); // Usar minúsculo para ID/Email
        const nome = nomeInput.value.trim();
        const role = roleInput.value.toUpperCase();

        if (uid.length < 3) return showToast("ID muito curto.", "warning");

        // ✅ PROTEÇÃO HIERÁRQUICA
        const myRoles = getUserRole() || [];
        const isMeAdmin = myRoles.includes('ADMIN');

        if (!isMeAdmin && role === 'ADMIN') {
            return showToast("Acesso Negado: Apenas Administradores podem criar outro Administrador.", "error");
        }

        const originalText = btn.innerText;
        btn.disabled = true; btn.innerText = "Salvando...";

        try {
            await setDoc(doc(dbInstance, 'users', uid), { 
                name: nome, 
                role: [role], // Salvando como array para manter padrão do sistema
                updatedAt: new Date() 
            }, { merge: true }); // Merge garante que não apague o PIN se já existir
            
            showToast("Usuário salvo com sucesso!", "success");
            registerLog('CAD_USER', uid, `Definiu cargo ${role} para ${nome}`);
            
            idInput.value = ''; nomeInput.value = '';
            idInput.focus();

        } catch (error) {
            console.error(error);
            showToast("Erro ao salvar usuário.", "error");
        } finally {
            btn.disabled = false; btn.innerText = originalText;
        }
    });
}

function listenToUsers() {
    const tbody = document.getElementById('tbody-users-list');
    const searchInput = document.getElementById('busca-user-input');
    if (!tbody) return;

    // Escuta em tempo real a coleção de usuários
    const q = query(collection(dbInstance, 'users'));
    onSnapshot(q, (snapshot) => {
        currentUsersList = [];
        snapshot.forEach(doc => {
            currentUsersList.push({ id: doc.id, ...doc.data() });
        });
        renderUsersTable();
    });

    if (searchInput) {
        searchInput.addEventListener('input', renderUsersTable);
    }
}

function renderUsersTable() {
    const tbody = document.getElementById('tbody-users-list');
    const searchInput = document.getElementById('busca-user-input');
    if (!tbody) return;

    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    // Filtra e ordena (Alfabético)
    let filtered = currentUsersList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (term) {
        filtered = filtered.filter(u => 
            (u.name && u.name.toLowerCase().includes(term)) || 
            (u.id && u.id.toLowerCase().includes(term))
        );
    }

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center italic text-slate-500">Nenhum usuário encontrado.</td></tr>';
        return;
    }

    filtered.forEach(user => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/50 transition-colors";
        
        const tdName = document.createElement('td'); 
        tdName.className = "p-3 font-bold text-white"; 
        tdName.textContent = user.name || 'Sem Nome';

        const tdId = document.createElement('td'); 
        tdId.className = "p-3 text-slate-400 font-mono"; 
        tdId.textContent = user.id;

        // Monta visual dos cargos
        const tdRole = document.createElement('td'); 
        tdRole.className = "p-3";
        let rolesArray = Array.isArray(user.role) ? user.role : [user.role || 'LEITOR'];
        
        rolesArray.forEach(r => {
            let colorClass = "bg-slate-700 text-slate-300"; // Default
            if (r === 'ADMIN') colorClass = "bg-red-900/30 text-red-400 border border-red-800";
            else if (r === 'LIDER') colorClass = "bg-amber-900/30 text-amber-400 border border-amber-800";
            else if (r === 'INVENTARIO') colorClass = "bg-indigo-900/30 text-indigo-400 border border-indigo-800";
            else if (r === 'OPERADOR') colorClass = "bg-emerald-900/30 text-emerald-400 border border-emerald-800";

            const span = document.createElement('span');
            span.className = `text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider mr-1 ${colorClass}`;
            span.textContent = r;
            tdRole.appendChild(span);
        });

        const tdAct = document.createElement('td'); 
        tdAct.className = "p-3 text-right";
        
        const btnDel = document.createElement('button'); 
        btnDel.className = "text-slate-500 hover:text-red-400 p-2 rounded transition";
        btnDel.title = "Remover Acesso";
        btnDel.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
        
        btnDel.onclick = () => {
            openConfirmModal("Remover Usuário?", `Deseja apagar o acesso de ${user.name}?`, async () => {
                try {
                    await deleteDoc(doc(dbInstance, 'users', user.id));
                    showToast("Usuário removido.");
                    closeConfirmModal();
                    registerLog('DEL_USER', user.id, 'Acesso removido manualmente');
                } catch(err) { showToast("Erro ao excluir", "error"); }
            });
        };

        tdAct.appendChild(btnDel);
        tr.append(tdName, tdId, tdRole, tdAct);
        tbody.appendChild(tr);
    });
}