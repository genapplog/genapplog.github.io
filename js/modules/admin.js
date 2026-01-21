/**
 * ARQUIVO: js/modules/admin.js
 * DESCRIÇÃO: Painel Administrativo (Importações, Logs, Auditoria + RELATÓRIOS).
 */

// ✅ 1. IMPORTAÇÕES NO TOPO
import { 
    writeBatch, 
    doc, 
    getDocs, 
    deleteDoc, 
    collection, 
    query, 
    where, 
    getDoc, 
    addDoc, 
    onSnapshot, 
    orderBy, 
    limit, 
    setDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { 
    safeBind, 
    showToast, 
    openConfirmModal, 
    closeConfirmModal, 
    renderSkeleton 
} from '../utils.js';

import { defaultChecklistData, specificClientRules, PATHS } from '../config.js';
import { getCurrentUserName, getUserRole } from './auth.js';

// --- ESTADO GERAL ---
let localAdminData = []; 
let globalDbForAdmin = null;
let currentAuditData = []; 

// =========================================================
// INICIALIZAÇÃO
// =========================================================
export function initAdminModule(db, clientsCollection) {
    console.log("Iniciando Módulo Admin...");
    globalDbForAdmin = db;

    // 1. Restaurar Padrões (Perigo!)
    safeBind('btn-reset-db', 'click', () => {
        openConfirmModal("Restaurar Padrões?", "PERIGO: Todos os checklists voltarão ao padrão de fábrica.", async () => {
            try {
                const s = await getDocs(clientsCollection);
                const b = writeBatch(db);
                s.forEach(d => {
                    const n = d.data().name?.toUpperCase().trim();
                    b.update(d.ref, { checklist: specificClientRules[n] || defaultChecklistData });
                });
                await b.commit();
                showToast("Padrões restaurados.");
                registerLog('RESET_SYSTEM', 'Sistema', 'Restaurou padrões de fábrica');
            } catch { showToast("Erro ao restaurar.", 'error'); }
            closeConfirmModal();
        });
    });

    // 2. Importação de Clientes
    safeBind('download-template-btn', 'click', () => downloadJSON([{ "name": "CLIENTE EXEMPLO", "checklist": defaultChecklistData }], "modelo_clientes.json"));
    
    safeBind('file-upload', 'change', (e) => handleImport(e, db, PATHS.clients, async (data, batch) => {
        const clientsRef = collection(db, PATHS.clients);
        const existingNames = new Map();
        (await getDocs(clientsRef)).forEach(d => existingNames.set(d.data().name.toUpperCase().trim(), d.id));
        
        let count = 0;
        data.forEach(c => {
            if(c.name) {
                const nameKey = c.name.toUpperCase().trim();
                const id = existingNames.get(nameKey);
                const ref = id ? doc(db, PATHS.clients, id) : doc(clientsRef);
                
                batch.set(ref, { 
                    name: nameKey, 
                    checklist: c.checklist || defaultChecklistData 
                }, { merge: true });
                count++;
            }
        });
        return count;
    }, 'import-status'));

    // 3. Importação de Usuários
    safeBind('download-users-template-btn', 'click', () => downloadJSON([{ "id": "UID_FIREBASE", "name": "Nome", "role": "OPERADOR, LIDER" }], "modelo_equipe.json"));
    
    safeBind('users-upload', 'change', (e) => handleImport(e, db, 'users', async (data, batch) => {
        let count = 0;
        data.forEach(u => {
            if(u.id && u.name) {
                let roles = ['LEITOR'];
                if (Array.isArray(u.role)) {
                    roles = u.role.map(r => r.toString().toUpperCase().trim());
                } else if (u.role && typeof u.role === 'string') {
                    roles = u.role.split(',').map(r => r.toUpperCase().trim()).filter(r => r !== "");
                }

                batch.set(doc(db, 'users', u.id.trim()), { 
                    name: u.name.trim(), 
                    role: roles, 
                    updatedAt: new Date() 
                });
                count++;
            }
        });
        return count;
    }, 'users-import-status'));

    // 4. Importação de Produtos
    safeBind('download-products-template-btn', 'click', () => downloadJSON([{ "dun": "17891000123456", "codigo": "200300", "descricao": "SHAMPOO" }], "modelo_produtos.json"));
    
    safeBind('products-upload', 'change', (e) => handleImport(e, db, 'products', async (data, batch) => {
        let count = 0;
        data.forEach(p => {
            if(p.dun && p.codigo) {
                const cleanDun = p.dun.replace(/\D/g, ''); 
                batch.set(doc(db, 'products', cleanDun), { 
                    codigo: p.codigo.toString().trim(), 
                    descricao: p.descricao.toUpperCase().trim(),
                    updatedAt: new Date() 
                });
                count++;
            }
        });
        return count;
    }, 'products-import-status'));

    // Inicializa busca de produtos
    setupProductSearch(db);

    // 5. Botões de Atualização e Filtro
    safeBind('btn-refresh-admin-list', 'click', () => { 
        renderAdminTable(); 
        const roles = getUserRole() || [];
        if(roles.includes('ADMIN')) loadInitialAuditLogs(db); 
    });
    
    safeBind('admin-search-rnc', 'input', () => renderAdminTable());
    safeBind('admin-search-label', 'input', () => renderAdminTable());
    safeBind('btn-audit-filter', 'click', () => filterAuditLogs(db));
    safeBind('btn-audit-export', 'click', () => exportAuditLogs());

    // Se for admin, carrega logs automaticamente
    const roles = getUserRole() || [];
    if(roles.includes('ADMIN')) {
        const auditSection = document.getElementById('admin-audit-section');
        if(auditSection) auditSection.classList.remove('hidden');
        loadInitialAuditLogs(db);
    }
    // ✅ 6. CLONAR DADOS (Apenas do Dia Atual)
    safeBind('btn-sync-prod-to-test', 'click', () => {
        openConfirmModal(
            "Clonar Ocorrências de Hoje?", 
            "Isso criará um arquivo JSON com todas as ocorrências registradas HOJE (desde a 00:00) para importação no ambiente de teste.", 
            async () => {
                try {
                    // 1. Define o início do dia atual (00:00:00)
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    // 2. Consulta filtrando por data (createdAt >= hoje)
                    const q = query(
                        collection(db, PATHS.occurrences), 
                        where('createdAt', '>=', today),
                        orderBy('createdAt', 'desc')
                    );

                    const snapshot = await getDocs(q);
                    const exportData = [];

                    snapshot.forEach(doc => {
                        const data = doc.data();
                        // Tratamento de Timestamps para JSON
                        if(data.createdAt?.toDate) data.createdAt = data.createdAt.toDate().toISOString();
                        
                        // Adiciona ao array de exportação
                        exportData.push({ 
                            original_id: doc.id, 
                            ...data 
                        });
                    });

                    if (exportData.length === 0) {
                        showToast("Nenhuma ocorrência encontrada hoje.", "warning");
                    } else {
                        // Gera o download
                        const fileName = `CLONE_DIA_${new Date().toISOString().slice(0,10)}.json`;
                        downloadJSON(exportData, fileName);
                        
                        showToast(`${exportData.length} registros do dia exportados!`);
                        registerLog('CLONE_EXPORT', 'Sistema', `Exportou ${exportData.length} itens do dia para teste`);
                    }

                } catch (e) {
                    console.error("Erro ao clonar:", e);
                    // Dica: Se der erro de índice, o console do navegador mostrará o link para criar
                    showToast("Erro ao buscar dados. Verifique o console (Índices).", "error");
                }
                closeConfirmModal();
            }
        );
    });
}

// =========================================================
// FUNÇÃO GENÉRICA DE IMPORTAÇÃO
// =========================================================
function handleImport(event, db, collectionNameOrPath, processFn, statusId) {
    const file = event.target.files[0]; if (!file) return;
    const statusDiv = document.getElementById(statusId);
    const statusText = document.getElementById(`${statusId}-text`);
    
    if(statusDiv) statusDiv.classList.remove('hidden'); 
    if(statusText) statusText.innerText = "Lendo arquivo...";
    
    const reader = new FileReader();
    reader.onload = async (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            if (!Array.isArray(data)) throw new Error("Formato inválido. O arquivo deve conter uma lista [].");
            
            const batch = writeBatch(db);
            const count = await processFn(data, batch);
            
            if(count > 0) await batch.commit();
            
            showToast(`${count} registros importados com sucesso!`);
            if(statusText) statusText.innerText = "Sucesso!";
            registerLog('IMPORT_DATA', String(collectionNameOrPath), `Importou ${count} registros via JSON`);
            
        } catch (e) { 
            console.error(e);
            showToast("Erro na importação: Verifique o arquivo JSON.", 'error'); 
            if(statusText) statusText.innerText = "Erro: " + e.message;
        }
        
        event.target.value = ''; 
        setTimeout(() => { if(statusDiv) statusDiv.classList.add('hidden'); }, 5000);
    };
    reader.readAsText(file);
}

// =========================================================
// AUDITORIA E LOGS
// =========================================================
export async function registerLog(action, target, details) {
    if (!globalDbForAdmin) return;
    try {
        const user = getCurrentUserName() || "Sistema/Anon";
        const role = getUserRole() || ["N/A"];
        await addDoc(collection(globalDbForAdmin, 'audit_logs'), {
            createdAt: new Date(), 
            user, 
            role: Array.isArray(role) ? role.join(', ') : role, 
            action: action.toUpperCase(), 
            target, 
            details
        });
    } catch (e) { console.error("Falha ao registrar log:", e); }
}

function loadInitialAuditLogs(db) {
    const tbody = document.getElementById('audit-list-tbody');
    if (tbody) renderSkeleton(tbody, 4, 5);

    const q = query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(10));
    onSnapshot(q, (snapshot) => {
        currentAuditData = [];
        snapshot.forEach(doc => currentAuditData.push({ id: doc.id, ...doc.data() }));
        renderAuditTable(currentAuditData);
    });
}

async function filterAuditLogs(db) {
    const startVal = document.getElementById('audit-filter-start').value;
    const endVal = document.getElementById('audit-filter-end').value;
    const tbody = document.getElementById('audit-list-tbody');

    if (!startVal || !endVal) return showToast("Selecione data de início e fim.", "info");
    
    const startDate = new Date(startVal + 'T00:00:00');
    const endDate = new Date(endVal + 'T23:59:59');

    if (tbody) renderSkeleton(tbody, 4, 5);

    try {
        const q = query(collection(db, 'audit_logs'), where('createdAt', '>=', startDate), where('createdAt', '<=', endDate), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        
        currentAuditData = [];
        snapshot.forEach(doc => currentAuditData.push({ id: doc.id, ...doc.data() }));
        
        if (currentAuditData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-slate-500 italic">Nenhum registro encontrado no período.</td></tr>';
        } else {
            renderAuditTable(currentAuditData);
            showToast(`${currentAuditData.length} registros encontrados.`);
        }
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center text-red-400 text-xs">Erro ao buscar logs (Índice pode estar faltando).</td></tr>';
    }
}

function renderAuditTable(data) {
    const tbody = document.getElementById('audit-list-tbody');
    if (!tbody) return;
    tbody.innerHTML = ''; 

    data.forEach(log => {
        const dateObj = log.createdAt?.toDate ? log.createdAt.toDate() : new Date(log.createdAt);
        const tr = document.createElement('tr');
        tr.className = "border-b border-slate-800 hover:bg-slate-800/50 transition-colors";

        const tdDate = document.createElement('td'); 
        tdDate.className = "px-4 py-3 font-mono text-slate-400 text-[10px] whitespace-nowrap"; 
        tdDate.textContent = dateObj.toLocaleString('pt-BR');
        
        const tdUser = document.createElement('td'); 
        tdUser.className = "px-4 py-3 text-white text-xs";
        const divUser = document.createElement('div'); divUser.className = "font-bold text-indigo-400"; divUser.textContent = log.user;
        const divRole = document.createElement('div'); divRole.className = "text-[9px] text-slate-500 uppercase tracking-wider"; divRole.textContent = log.role;
        tdUser.append(divUser, divRole);

        const tdAction = document.createElement('td'); 
        tdAction.className = "px-4 py-3 text-xs font-bold text-slate-200";
        const spanAction = document.createElement('span'); 
        spanAction.className = "bg-slate-700 px-2 py-1 rounded border border-slate-600"; 
        spanAction.textContent = log.action;
        tdAction.appendChild(spanAction);

        const tdDetails = document.createElement('td'); 
        tdDetails.className = "px-4 py-3 text-xs text-slate-400 italic"; 
        tdDetails.textContent = `${log.target} - ${log.details}`;

        tr.append(tdDate, tdUser, tdAction, tdDetails);
        tbody.appendChild(tr);
    });
}

function exportAuditLogs() {
    if (currentAuditData.length === 0) return showToast("Sem dados para exportar.", "info");
    
    const exportList = currentAuditData.map(log => ({
        "Data/Hora": log.createdAt?.toDate ? log.createdAt.toDate().toLocaleString('pt-BR') : '-',
        "Usuário": log.user, 
        "Cargo": log.role, 
        "Ação": log.action, 
        "Alvo": log.target, 
        "Detalhes": log.details
    }));
    
    if (window.XLSX) {
        const ws = XLSX.utils.json_to_sheet(exportList);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Auditoria");
        XLSX.writeFile(wb, `AuditLog_${new Date().toISOString().slice(0,10)}.xlsx`);
    } else { showToast("Erro: Biblioteca XLSX não carregada.", "error"); }
}

// =========================================================
// TABELA ADMIN E GESTÃO
// =========================================================
export function updateAdminList(data) {
    localAdminData = data;
    renderAdminTable();
}

function renderAdminTable() {
    const tbodyRNC = document.getElementById('admin-oc-list-tbody');
    const tbodyLabels = document.getElementById('admin-label-list-tbody');
    const searchRNC = document.getElementById('admin-search-rnc');
    const searchLabel = document.getElementById('admin-search-label');

    if (!tbodyRNC || !tbodyLabels) return;

    const termRNC = searchRNC ? searchRNC.value.toLowerCase().trim() : "";
    const termLabel = searchLabel ? searchLabel.value.toLowerCase().trim() : "";
    
    const uniqueList = Array.from(new Map(localAdminData.map(item => [item.id, item])).values());
    let rncList = uniqueList.filter(d => d.type !== 'pallet_label_request').sort((a,b) => b.jsDate - a.jsDate);
    let labelList = uniqueList.filter(d => d.type === 'pallet_label_request').sort((a,b) => b.jsDate - a.jsDate);

    if (termRNC) rncList = rncList.filter(item => `${item.embarque || ''} ${item.nf || ''} ${item.tipo || ''}`.toLowerCase().includes(termRNC));
    if (termLabel) labelList = labelList.filter(item => `${item.item || ''} ${item.lote || ''}`.toLowerCase().includes(termLabel));

    // Renderiza Tabela RNC (Últimos 10)
    const rncDisplay = rncList.slice(0, 10);
    tbodyRNC.innerHTML = '';
    
    if (rncDisplay.length === 0) { 
        tbodyRNC.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-center text-slate-600 italic">Sem registros recentes.</td></tr>'; 
    } else {
        rncDisplay.forEach(item => {
            const tr = document.createElement('tr'); 
            tr.className = "hover:bg-slate-800 transition-colors border-b border-slate-800/50";
            
            const tdData = document.createElement('td'); 
            tdData.className = "px-4 py-3 text-slate-300 font-mono text-xs";
            tdData.append(document.createTextNode(item.jsDate.toLocaleDateString('pt-BR')), document.createElement('br'));
            const spanTipo = document.createElement('span'); spanTipo.className = "font-bold text-white uppercase"; spanTipo.textContent = item.tipo;
            tdData.appendChild(spanTipo);

            const tdRef = document.createElement('td'); 
            tdRef.className = "px-4 py-3 text-slate-300 text-xs";
            const spanEmb = document.createElement('span'); spanEmb.className = "text-white font-medium"; spanEmb.textContent = item.embarque || 'S/ Emb';
            const spanNf = document.createElement('span'); spanNf.className = "text-slate-500 block"; spanNf.textContent = item.nf || 'S/ Cliente';
            tdRef.append(spanEmb, spanNf);

            const tdActions = document.createElement('td'); 
            tdActions.className = "px-4 py-3 text-right";
            const divBtns = document.createElement('div'); divBtns.className = "flex gap-2 justify-end";

            // Botão de Imprimir (RNC) - Agora chama a função window.printOccurrence
            const btnPrint = document.createElement('button'); 
            btnPrint.className = "text-indigo-400 hover:text-white bg-indigo-900/20 hover:bg-indigo-600 p-2 rounded transition btn-print-rnc";
            btnPrint.dataset.id = item.id; btnPrint.title = "Imprimir";
            btnPrint.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>';
            
            const btnDel = document.createElement('button'); 
            btnDel.className = "text-red-400 hover:text-white bg-red-900/20 hover:bg-red-600 p-2 rounded transition btn-del-adm";
            btnDel.dataset.id = item.id; btnDel.title = "Excluir";
            btnDel.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';

            divBtns.append(btnPrint, btnDel);
            tdActions.appendChild(divBtns);
            tr.append(tdData, tdRef, tdActions);
            tbodyRNC.appendChild(tr);
        });
    }

    // Renderiza Tabela Labels
    const labelDisplay = labelList.slice(0, 10);
    tbodyLabels.innerHTML = '';
    if (labelDisplay.length === 0) { 
        tbodyLabels.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-center text-slate-600 italic">Sem registros recentes.</td></tr>'; 
    } else {
        labelDisplay.forEach(item => {
            const tr = document.createElement('tr'); 
            tr.className = "hover:bg-slate-800 transition-colors border-b border-slate-800/50";
            
            const tdData = document.createElement('td'); 
            tdData.className = "px-4 py-3 text-slate-300 font-mono text-xs";
            tdData.textContent = `${item.jsDate.toLocaleDateString('pt-BR')} ${item.jsDate.toLocaleTimeString('pt-BR')}`;

            const tdItem = document.createElement('td'); 
            tdItem.className = "px-4 py-3 text-slate-300 text-xs";
            const divItem = document.createElement('div'); divItem.className = "truncate font-bold text-white text-sm"; divItem.textContent = item.item;
            const spanLote = document.createElement('span'); spanLote.className = "text-cyan-400"; spanLote.textContent = `Lote: ${item.lote}`;
            tdItem.append(divItem, spanLote);

            const tdActions = document.createElement('td'); 
            tdActions.className = "px-4 py-3 text-right";
            const btnDel = document.createElement('button'); 
            btnDel.className = "text-red-400 hover:text-white bg-red-900/20 hover:bg-red-600 p-2 rounded transition btn-del-adm";
            btnDel.dataset.id = item.id;
            btnDel.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
            tdActions.appendChild(btnDel);

            tr.append(tdData, tdItem, tdActions);
            tbodyLabels.appendChild(tr);
        });
    }

    // Eventos de Exclusão (Admin)
    const currentPath = PATHS.occurrences;
    document.querySelectorAll('.btn-del-adm').forEach(btn => { 
        btn.onclick = (e) => { 
            const id = e.currentTarget.dataset.id; 
            openConfirmModal("Excluir Definitivamente?", "Esta ação não pode ser desfeita.", async () => { 
                try { 
                    await deleteDoc(doc(globalDbForAdmin, currentPath, id)); 
                    showToast("Registro excluído."); 
                    closeConfirmModal(); 
                    registerLog('EXCLUIR_REG', id, 'Admin excluiu registro forçadamente');
                } catch(err) { 
                    console.error(err); 
                    showToast("Erro ao excluir.", "error"); 
                } 
            }); 
        }; 
    });
    
    // Evento de Impressão corrigido para chamar a nova função global
    document.querySelectorAll('.btn-print-rnc').forEach(btn => {
        btn.onclick = (e) => window.printOccurrence(e.currentTarget.dataset.id);
    });
}

// =========================================================
// BUSCA E GESTÃO DE PRODUTOS
// =========================================================
function setupProductSearch(db) {
    const btnSearch = document.getElementById('btn-search-product');
    const inputSearch = document.getElementById('product-search-input');
    const listContainer = document.getElementById('product-list-container');
    const tbody = document.getElementById('product-list-tbody');
    const msg = document.getElementById('product-search-msg');

    const doSearch = async () => {
        const term = inputSearch.value.toUpperCase().trim();
        if (term.length < 3) return showToast("Digite no mínimo 3 caracteres.", "info");
        
        tbody.innerHTML = '<tr><td colspan="3" class="p-2 text-center">Buscando...</td></tr>';
        listContainer.classList.remove('hidden'); 
        msg.classList.add('hidden');

        try {
            const productsRef = collection(db, 'products');
            let results = [];
            
            if (/^\d+$/.test(term)) {
                const docSnap = await getDoc(doc(db, 'products', term));
                if (docSnap.exists()) results.push({ id: docSnap.id, ...docSnap.data() });
            }
            
            if (results.length === 0) {
                const q = query(productsRef); 
                const querySnapshot = await getDocs(q);
                querySnapshot.forEach((doc) => {
                    const d = doc.data();
                    if (doc.id.includes(term) || d.descricao.includes(term) || d.codigo.includes(term)) {
                        results.push({ id: doc.id, ...d });
                    }
                });
            }
            
            renderProdTable(results.slice(0, 10), db);
            
        } catch (e) { 
            console.error(e); 
            tbody.innerHTML = '<tr><td colspan="3" class="p-2 text-center text-red-400">Erro na busca.</td></tr>'; 
        }
    };

    const renderProdTable = (items, db) => {
        tbody.innerHTML = '';
        if (items.length === 0) { 
            listContainer.classList.add('hidden'); 
            msg.classList.remove('hidden'); 
            return; 
        }
        
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = "border-b border-slate-800 hover:bg-slate-800 transition-colors";
            
            const tdId = document.createElement('td'); 
            tdId.className = "p-2 font-mono text-orange-300 text-xs"; 
            tdId.textContent = item.id;
            
            const tdDesc = document.createElement('td'); 
            tdDesc.className = "p-2";
            const divD = document.createElement('div'); divD.className = "font-bold text-white text-xs"; divD.textContent = item.descricao;
            const divC = document.createElement('div'); divC.className = "text-[10px] text-gray-500"; divC.textContent = `Cód: ${item.codigo}`;
            tdDesc.append(divD, divC);

            const tdAct = document.createElement('td'); 
            tdAct.className = "p-2 text-right";
            const btn = document.createElement('button'); 
            btn.className = "text-red-400 hover:text-white bg-red-900/20 hover:bg-red-600 p-1.5 rounded transition btn-del-prod";
            btn.dataset.id = item.id; 
            btn.title = "Excluir Produto";
            btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
            tdAct.appendChild(btn);

            tr.append(tdId, tdDesc, tdAct);
            tbody.appendChild(tr);
        });

        document.querySelectorAll('.btn-del-prod').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                openConfirmModal("Excluir Produto?", `DUN: ${id}`, async () => {
                    await deleteDoc(doc(db, 'products', id));
                    showToast("Produto excluído.");
                    closeConfirmModal();
                    doSearch(); 
                });
            });
        });
    };

    if(btnSearch) btnSearch.addEventListener('click', doSearch);
    if(inputSearch) inputSearch.addEventListener('keypress', (e) => { if(e.key === 'Enter') doSearch(); });
}

function downloadJSON(data, filename) {
    const a = document.createElement('a');
    a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    a.download = filename;
    document.body.appendChild(a); 
    a.click(); 
    a.remove();
}

// =================================================================
// 🔥 LÓGICA DE IMPRESSÃO (NOVO CÓDIGO INTEGRADO)
// =================================================================

window.printOccurrence = async function(id) {
    if (!id || !globalDbForAdmin) return;

    try {
        const docRef = doc(globalDbForAdmin, PATHS.occurrences, id);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            showToast("Registro não encontrado.", "error");
            return;
        }

        const data = docSnap.data();
        data.id = docSnap.id;
        generatePrintLayout(data);

    } catch (e) {
        console.error("Erro ao gerar relatório:", e);
        showToast("Erro ao gerar impressão.", "error");
    }
};

function generatePrintLayout(data) {
    const printWindow = window.open('', '_blank');
    
    // Formatação de Datas
    const dateOpts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const dateStr = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString('pt-BR', dateOpts) : new Date().toLocaleDateString('pt-BR');
    const ocurrenceDate = data.dataRef ? new Date(data.dataRef).toLocaleDateString('pt-BR', dateOpts) : dateStr;

    // LÓGICA DE PRODUTOS (TABELA OU ÚNICO)
    let productsHtml = '';
    
    // Verifica se tem array de itens e se tem mais de 1 (ou se é array mesmo com 1 item novo)
    const hasItemsArray = data.items && Array.isArray(data.items) && data.items.length > 0;

    if (hasItemsArray) {
        // --- MODO TABELA (DETALHADO) ---
        const rows = data.items.map(item => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px; font-size: 10px; font-weight: bold; color: #475569; text-transform: uppercase;">${item.tipo}</td>
                <td style="padding: 8px; font-family: monospace; font-weight: bold; font-size: 11px;">${item.item_cod}</td>
                <td style="padding: 8px; font-size: 11px;">${item.item_desc}</td>
                <td style="padding: 8px; font-size: 11px;">${item.item_lote || '-'}</td>
                <td style="padding: 8px; font-weight: bold; text-align: center; color: #ef4444;">${item.item_qtd}</td>
                <td style="padding: 8px; font-size: 10px; color: #64748b;">${item.local}</td>
            </tr>
        `).join('');

        productsHtml = `
            <div style="margin-top: 15px; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden;">
                <div style="background-color: #f1f5f9; padding: 8px 12px; font-size: 11px; font-weight: bold; color: #334155; border-bottom: 1px solid #cbd5e1; text-transform: uppercase;">
                    Detalhamento dos Itens (${data.items.length})
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                    <thead style="background-color: #f8fafc;">
                        <tr>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 10%;">TIPO</th>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 15%;">CÓDIGO</th>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0;">DESCRIÇÃO</th>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 15%;">LOTE</th>
                            <th style="text-align: center; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 8%;">QTD</th>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 15%;">LOCAL</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    } else {
        // --- MODO LEGADO (ITEM ÚNICO ANTIGO) ---
        productsHtml = `
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-top: 15px; padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
                <div>
                    <label style="display: block; font-size: 9px; color: #64748b; font-weight: bold; margin-bottom: 2px;">PRODUTO AFETADO</label>
                    <div style="font-size: 14px; font-weight: bold; color: #1e293b;">${data.item_cod || '-'} - ${data.item_desc || '-'}</div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div>
                        <label style="display: block; font-size: 9px; color: #64748b; font-weight: bold; margin-bottom: 2px;">LOTE</label>
                        <div style="font-size: 12px; color: #334155;">${data.item_lote || '-'}</div>
                    </div>
                    <div>
                        <label style="display: block; font-size: 9px; color: #64748b; font-weight: bold; margin-bottom: 2px;">QTD (CX)</label>
                        <div style="font-size: 14px; font-weight: bold; color: #ef4444;">${data.item_qtd || '0'}</div>
                    </div>
                </div>
            </div>
        `;
    }

    const statusColor = data.status === 'concluido' ? '#10b981' : '#f59e0b';
    const statusText = data.status === 'concluido' ? 'CONCLUÍDO' : 'PENDENTE';

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>RNC #${data.id.slice(0, 8)}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #0f172a; max-width: 900px; margin: 0 auto; background: white; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 30px; }
            .logo h1 { font-size: 24px; font-weight: 800; letter-spacing: -1px; margin: 0; color: #0f172a; }
            .logo p { font-size: 12px; color: #64748b; margin: 2px 0 0 0; }
            .meta { text-align: right; font-size: 10px; color: #64748b; }
            .title-box { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
            .title-box h2 { font-size: 28px; font-weight: 800; margin: 0; text-transform: uppercase; color: #1e293b; }
            .status-badge { background-color: ${statusColor}; color: white; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
            
            .section { border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px; background: #fff; }
            .section-title { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px; letter-spacing: 0.5px; }
            
            .info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
            .field label { display: block; font-size: 9px; color: #64748b; font-weight: bold; text-transform: uppercase; margin-bottom: 3px; }
            .field div { font-size: 13px; font-weight: 600; color: #1e293b; }

            .checkbox-group { display: flex; gap: 20px; }
            .check-item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
            .check-box { width: 14px; height: 14px; border: 1px solid #94a3b8; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; }
            .check-box.checked { background: #0f172a; border-color: #0f172a; color: white; }

            .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 50px; border-top: 2px solid #e2e8f0; padding-top: 30px; }
            .sig-block { text-align: center; }
            .sig-line { border-bottom: 1px solid #0f172a; margin-bottom: 8px; height: 30px; display: flex; align-items: flex-end; justify-content: center; font-family: 'Courier New', monospace; font-size: 12px; font-weight: bold; }
            .sig-label { font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase; }

            @media print {
                body { padding: 0; margin: 20px; }
                .no-print { display: none; }
            }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="logo">
                <h1>AppLog</h1>
                <p>Gestão de Qualidade & Estoque</p>
            </div>
            <div class="meta">
                ID: ${data.id}<br>
                Emissão: ${new Date().toLocaleString('pt-BR')}<br>
                REF: ${(data.embarque || 'N/A')}
            </div>
        </div>

        <div class="title-box">
            <h2>Relatório de Divergência</h2>
            <div class="status-badge">${statusText}</div>
        </div>

        <div class="section">
            <div class="section-title">Informações Gerais</div>
            <div class="info-grid">
                <div class="field"><label>Data Ocorrência</label><div>${ocurrenceDate}</div></div>
                <div class="field"><label>Embarque</label><div>${data.embarque || '-'}</div></div>
                <div class="field"><label>Cliente / NF</label><div>${data.nf || '-'}</div></div>
                <div class="field"><label>Infrator / Origem</label><div>${data.infrator || 'N/A'}</div></div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Detalhamento da Ocorrência</div>
            ${productsHtml}
        </div>

        <div class="section">
            <div class="info-grid" style="grid-template-columns: 1fr 1fr;">
                <div>
                    <div class="section-title">Condição da Embalagem</div>
                    <div class="checkbox-group">
                        <div class="check-item"><div class="check-box ${data.emb_amassada ? 'checked' : ''}">${data.emb_amassada ? '✓' : ''}</div> Amassada</div>
                        <div class="check-item"><div class="check-box ${data.emb_rasgada ? 'checked' : ''}">${data.emb_rasgada ? '✓' : ''}</div> Rasgada</div>
                        <div class="check-item"><div class="check-box ${data.emb_vazamento ? 'checked' : ''}">${data.emb_vazamento ? '✓' : ''}</div> Vazamento</div>
                    </div>
                    ${data.emb_outros ? `<div style="margin-top: 8px; font-size: 11px;">Outros: <b>${data.emb_outros}</b></div>` : ''}
                </div>
                <div>
                    <div class="section-title">Observações / Relato</div>
                    <div style="font-size: 12px; color: #334155; line-height: 1.4;">${data.obs || 'Nenhuma observação registrada.'}</div>
                </div>
            </div>
        </div>

        <div class="signatures">
            <div class="sig-block">
                <div class="sig-line">${data.ass_colab || ''}</div>
                <div class="sig-label">Reportado Por</div>
            </div>
            <div class="sig-block">
                <div class="sig-line">${data.ass_lider || ''}</div>
                <div class="sig-label">Validação Liderança</div>
            </div>
            <div class="sig-block">
                <div class="sig-line">${data.ass_inv || ''}</div>
                <div class="sig-label">Conclusão Inventário</div>
            </div>
        </div>

        <script>
            window.onload = function() { window.print(); }
        </script>
    </body>
    </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
}