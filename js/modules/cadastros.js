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
import { getUserRole } from './auth.js'; 

let dbInstance = null;
let currentUsersList = [];

// Controle de Ordenação
let userSortConfig = {
    key: 'name',
    direction: 'asc' // 'asc' ou 'desc'
};

export function initCadastrosModule(db) {
    console.log("Iniciando Módulo de Cadastros Manuais...");
    dbInstance = db;

    setupTabs();
    setupProductForm();
    setupProductSearchUI(); // Interface de busca de produtos atualizada
    setupUserForm();
    listenToUsers();
    setupUserSorting(); 
    
    // Escuta o sinal de que o login completou para desenhar os botões
    document.addEventListener('user-profile-ready', () => {
        renderUsersTable();
        const roles = getUserRole() || [];
        if (!roles.includes('ADMIN')) {
            const adminOption = document.querySelector('#cad-user-role option[value="ADMIN"]');
            if (adminOption) adminOption.disabled = true;
        }
    });

    // Fallback: Tenta atualizar após 1.5s caso o evento já tenha passado
    setTimeout(renderUsersTable, 1500);
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
        btnProd.classList.replace('border-transparent', 'border-indigo-500');
        btnProd.classList.replace('text-slate-500', 'text-indigo-400');
        btnEquipe.classList.replace('border-indigo-500', 'border-transparent');
        btnEquipe.classList.replace('text-emerald-400', 'text-slate-500');
        
        tabProd.classList.remove('hidden');
        tabEquipe.classList.add('hidden');
    });

    safeBind('tab-btn-equipe', 'click', () => {
        btnEquipe.classList.replace('border-transparent', 'border-indigo-500');
        btnEquipe.classList.replace('text-slate-500', 'text-emerald-400');
        btnProd.classList.replace('border-indigo-500', 'border-transparent');
        btnProd.classList.replace('text-indigo-400', 'text-slate-500');
        
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

        // Limpa formatação
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

            // Atualiza a tabela de pesquisa se houver algo digitado
            const searchInput = document.getElementById('cad-busca-prod-input');
            if(searchInput && searchInput.value) {
                searchInput.dispatchEvent(new Event('input'));
            }

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

    // ✅ Layout Autocomplete Limpo com Coluna SAP Separada (colspan=4)
    container.innerHTML = `
        <div class="bg-slate-900 p-4 rounded-xl border border-slate-700 shadow-sm relative">
            <h4 class="text-sm font-bold text-white uppercase tracking-wider mb-3">Consultar Produtos Cadastrados</h4>
            
            <div class="relative w-full mb-4">
                <input type="text" id="cad-busca-prod-input" autocomplete="off" placeholder="DIGITE O DUN, SAP OU DESCRIÇÃO PARA BUSCAR..." class="w-full bg-slate-800 border border-slate-600 text-white text-xs p-3 rounded-lg outline-none focus:border-indigo-500 transition-all uppercase placeholder-slate-500 pr-10 shadow-inner">
                <svg class="w-4 h-4 text-slate-400 absolute right-4 top-[14px] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            </div>

            <div class="overflow-hidden rounded-lg border border-slate-700 shadow">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-950 text-slate-400 font-medium uppercase text-[10px]">
                        <tr>
                            <th class="p-3 tracking-wider w-24">Código (SAP)</th>
                            <th class="p-3 tracking-wider w-36">DUN (Cód. Barras)</th>
                            <th class="p-3 tracking-wider">Descrição do Produto</th>
                            <th class="p-3 text-right w-16">Ação</th>
                        </tr>
                    </thead>
                    <tbody id="cad-tbody-prod-list" class="divide-y divide-slate-800 text-slate-300">
                        <tr><td colspan="4" class="p-5 text-center text-[11px] font-bold text-slate-500 tracking-widest uppercase">Comece a digitar para pesquisar...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const inputSearch = document.getElementById('cad-busca-prod-input');
    const tbody = document.getElementById('cad-tbody-prod-list');
    let searchTimeout = null;

    // ✅ Motor de Busca Automática
    const doSearch = async () => {
        const term = inputSearch.value.toUpperCase().trim();
        
        if (term.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-5 text-center text-[11px] font-bold text-slate-500 tracking-widest uppercase">Comece a digitar para pesquisar...</td></tr>';
            return;
        }

        if (term.length < 3) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-5 text-center text-[11px] font-bold text-amber-500/50 tracking-widest uppercase">Digite pelo menos 3 caracteres...</td></tr>';
            return; 
        }
        
        tbody.innerHTML = '<tr><td colspan="4" class="p-5 text-center text-indigo-400 font-bold uppercase tracking-widest"><span class="animate-pulse">Buscando...</span></td></tr>';

        try {
            const productsRef = collection(dbInstance, 'products');
            let results = [];
            
            // 1. Busca direta por ID
            if (/^\d+$/.test(term)) {
                const docSnap = await getDoc(doc(dbInstance, 'products', term));
                if (docSnap.exists()) results.push({ id: docSnap.id, ...docSnap.data() });
            }
            
            // 2. Varredura por texto
            if (results.length === 0) {
                const q = query(productsRef); 
                const querySnapshot = await getDocs(q);
                for (const doc of querySnapshot.docs) {
                    const d = doc.data();
                    if (doc.id.includes(term) || d.descricao.includes(term) || d.codigo.includes(term)) {
                        results.push({ id: doc.id, ...d });
                        if (results.length >= 15) break; 
                    }
                }
            }
            
            renderProdTable(results);
            
        } catch (e) { 
            console.error(e); 
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-400 font-bold uppercase">Erro na comunicação com o banco.</td></tr>'; 
        }
    };

    const renderProdTable = (items) => {
        tbody.innerHTML = '';
        if (items.length === 0) { 
            tbody.innerHTML = '<tr><td colspan="4" class="p-5 text-center text-[11px] font-bold text-slate-500 tracking-widest uppercase">Nenhum produto compatível encontrado.</td></tr>'; 
            return; 
        }
        
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-800 transition-colors group";
            
            // Coluna 1: Código SAP
            const tdSap = document.createElement('td'); 
            tdSap.className = "p-3 font-mono text-slate-400 font-bold"; 
            tdSap.textContent = item.codigo || '-';

            // Coluna 2: DUN
            const tdId = document.createElement('td'); 
            tdId.className = "p-3 font-mono text-indigo-400 font-bold tracking-wider"; 
            tdId.textContent = item.id;
            
            // Coluna 3: Descrição
            const tdDesc = document.createElement('td'); 
            tdDesc.className = "p-3 font-bold text-white uppercase";
            tdDesc.textContent = item.descricao || '-';

            // Coluna 4: Ação
            const tdAct = document.createElement('td'); 
            tdAct.className = "p-3 text-right";
            
            const btnDel = document.createElement('button'); 
            btnDel.className = "text-slate-600 hover:text-white bg-transparent hover:bg-red-600 p-2 rounded transition opacity-50 group-hover:opacity-100";
            btnDel.title = "Excluir Produto";
            btnDel.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
            
            btnDel.onclick = () => {
                openConfirmModal("Excluir Produto?", `Remover o item: ${item.descricao}?`, async () => {
                    try {
                        await deleteDoc(doc(dbInstance, 'products', item.id));
                        showToast("Produto excluído do banco.");
                        closeConfirmModal();
                        document.getElementById('cad-busca-prod-input').dispatchEvent(new Event('input')); // Recarrega
                        registerLog('DEL_PRODUTO', item.id, 'Produto excluído da base');
                    } catch(err) { showToast("Falha ao excluir", "error"); }
                });
            };

            tdAct.appendChild(btnDel);
            
            // Adiciona as 4 colunas na linha
            tr.append(tdSap, tdId, tdDesc, tdAct);
            tbody.appendChild(tr);
        });
    };

    // ✅ Dispara a busca enquanto o usuário digita (com debounce de 500ms para poupar o banco)
    if (inputSearch) {
        inputSearch.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(doSearch, 500); 
        });
    }
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

        const uid = idInput.value.trim().toLowerCase(); 
        const nome = nomeInput.value.trim().toUpperCase(); 
        const role = roleInput.value.toUpperCase();

        if (uid.length < 3) return showToast("ID muito curto.", "warning");

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
                role: [role], 
                updatedAt: new Date() 
            }, { merge: true }); 
            
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

function setupUserSorting() {
    const config = [
        { id: 'sort-user-name', key: 'name' },
        { id: 'sort-user-id', key: 'id' },
        { id: 'sort-user-role', key: 'role' }
    ];

    config.forEach(item => {
        safeBind(item.id, 'click', () => {
            if (userSortConfig.key === item.key) {
                userSortConfig.direction = userSortConfig.direction === 'asc' ? 'desc' : 'asc';
            } else {
                userSortConfig.key = item.key;
                userSortConfig.direction = 'asc';
            }
            renderUsersTable();
        });
    });
}

function renderUsersTable() {
    const tbody = document.getElementById('tbody-users-list');
    const searchInput = document.getElementById('busca-user-input');
    if (!tbody) return;

    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const myRoles = getUserRole() || [];

    let filtered = [...currentUsersList];
    if (term) {
        filtered = filtered.filter(u => 
            (u.name && u.name.toLowerCase().includes(term)) || 
            (u.id && u.id.toLowerCase().includes(term))
        );
    }

    filtered.sort((a, b) => {
        let valA = a[userSortConfig.key] || '';
        let valB = b[userSortConfig.key] || '';

        if (userSortConfig.key === 'role') {
            valA = Array.isArray(valA) ? valA[0] : valA;
            valB = Array.isArray(valB) ? valB[0] : valB;
        }

        if (userSortConfig.direction === 'asc') {
            return valA.toString().localeCompare(valB.toString());
        } else {
            return valB.toString().localeCompare(valA.toString());
        }
    });

    ['name', 'id', 'role'].forEach(k => {
        const icon = document.getElementById(`icon-sort-${k}`);
        if (icon) {
            if (userSortConfig.key === k) {
                icon.textContent = userSortConfig.direction === 'asc' ? '▲' : '▼';
                icon.classList.remove('opacity-0');
                icon.classList.add('text-indigo-400');
            } else {
                icon.textContent = '↕';
                icon.classList.add('opacity-0');
                icon.classList.remove('text-indigo-400');
            }
        }
    });

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center italic text-slate-500">Nenhum usuário encontrado.</td></tr>';
        return;
    }

    filtered.forEach(user => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/50 transition-colors";
        
        const tdName = document.createElement('td'); 
        tdName.className = "p-3 font-bold text-white uppercase"; 
        tdName.textContent = (user.name || 'Sem Nome').toUpperCase();

        const tdId = document.createElement('td');
        tdId.className = "p-3 text-slate-400 font-mono text-xs"; 
        tdId.textContent = user.id;

        const tdRole = document.createElement('td'); 
        tdRole.className = "p-3";
        let rolesArray = Array.isArray(user.role) ? user.role : [user.role || 'LEITOR'];
        
        rolesArray.forEach(r => {
            let colorClass = "bg-slate-700 text-slate-300";
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
        tdAct.className = "p-3 text-right whitespace-nowrap";
        
        const canManageUsers = myRoles.some(r => ['ADMIN', 'LIDER', 'INVENTARIO'].includes(r));

        if (canManageUsers) {
            const btnDel = document.createElement('button'); 
            btnDel.className = "text-slate-500 hover:text-red-400 p-2 rounded transition";
            btnDel.title = "Remover Acesso";
            btnDel.innerHTML = '<svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
            
            btnDel.onclick = () => {
                openConfirmModal("Remover Usuário?", `Deseja apagar o acesso de ${user.name.toUpperCase()}?`, async () => {
                    try {
                        await deleteDoc(doc(dbInstance, 'users', user.id));
                        showToast("Usuário removido.");
                        closeConfirmModal();
                        registerLog('DEL_USER', user.id, 'Remoção manual via tela de Cadastros');
                    } catch(err) { 
                        console.error(err);
                        showToast("Erro ao excluir", "error"); 
                    }
                });
            };
            tdAct.appendChild(btnDel);
        }

        tr.append(tdName, tdId, tdRole, tdAct);
        tbody.appendChild(tr);
    });
}