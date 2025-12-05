/**
 * ARQUIVO: js/modules/admin.js
 * DESCRIÇÃO: Funcionalidades Administrativas (Importação, Exportação, Reset e Gestão de Tabelas).
 */
import { writeBatch, doc, getDocs, deleteDoc, collection, query, where, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { safeBind, showToast, openConfirmModal, closeConfirmModal } from '../utils.js';
import { defaultChecklistData, specificClientRules, PATHS } from '../config.js';
// Importa a impressão para usar no botão da lista administrativa
import { printRncReport } from './dashboard.js';

// Variáveis locais
let localAdminData = []; 
let globalDbForAdmin = null;

export function initAdminModule(db, clientsCollection) {
    globalDbForAdmin = db;

    // 1. Resetar Checklist (Restaurar Padrão)
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
            } catch { showToast("Erro ao restaurar.", 'error'); }
            closeConfirmModal();
        });
    });

    // 1.1 Clonar Produção -> Testes
    safeBind('btn-sync-prod-to-test', 'click', () => {
        openConfirmModal("Sobrescrever Testes?", "Isso apagará TUDO no ambiente de Teste e copiará os dados de Produção.", async () => {
            try {
                showToast("Iniciando clonagem...", "info");
                
                const copyCollection = async (pathProd, pathTest) => {
                    const refProd = collection(db, pathProd);
                    const refTest = collection(db, pathTest);
                    
                    const snapProd = await getDocs(refProd);
                    const snapTest = await getDocs(refTest);
                    
                    const batch = writeBatch(db);
                    
                    // Limpa destino
                    snapTest.forEach(doc => batch.delete(doc.ref));
                    
                    // Copia origem
                    snapProd.forEach(doc => {
                        const newRef = doc(refTest, doc.id);
                        batch.set(newRef, doc.data());
                    });
                    
                    await batch.commit();
                };

                await copyCollection(PATHS.prod.clients, PATHS.test.clients);
                await copyCollection(PATHS.prod.occurrences, PATHS.test.occurrences);
                
                showToast("Ambiente de Teste atualizado!");
                setTimeout(() => window.location.reload(), 1500);

            } catch (e) {
                console.error(e);
                showToast("Erro ao clonar: " + e.message, 'error');
            }
            closeConfirmModal();
        });
    });

    // 2. Importações e Downloads
    safeBind('download-template-btn', 'click', () => downloadJSON([{ "name": "CLIENTE EXEMPLO", "checklist": defaultChecklistData }], "modelo_clientes.json"));
    
    safeBind('file-upload', 'change', (e) => handleImport(e, db, 'clients', async (data, batch) => {
        const existingNames = new Map();
        (await getDocs(clientsCollection)).forEach(d => existingNames.set(d.data().name.toUpperCase().trim(), d.id));
        let count = 0;
        data.forEach(c => {
            if(c.name) {
                const id = existingNames.get(c.name.toUpperCase().trim());
                const ref = id ? doc(clientsCollection, id) : doc(clientsCollection);
                batch.set(ref, { name: c.name.toUpperCase().trim(), checklist: c.checklist || defaultChecklistData }, { merge: true });
                count++;
            }
        });
        return count;
    }, 'import-status'));

    safeBind('download-users-template-btn', 'click', () => downloadJSON([{ "id": "UID_FIREBASE", "name": "Nome", "role": "OPERADOR" }], "modelo_equipe.json"));
    
    safeBind('users-upload', 'change', (e) => handleImport(e, db, 'users', async (data, batch) => {
        let count = 0;
        data.forEach(u => {
            if(u.id && u.name) {
                batch.set(doc(db, 'users', u.id.trim()), { name: u.name.trim(), role: u.role?.toUpperCase() || 'LEITOR', updatedAt: new Date() });
                count++;
            }
        });
        return count;
    }, 'users-import-status'));

    safeBind('download-products-template-btn', 'click', () => downloadJSON([{ "dun": "17891000123456", "codigo": "200300", "descricao": "SHAMPOO TIO NACHO 400ML" }], "modelo_produtos.json"));

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

    setupProductSearch(db);

    // 3. LISTENERS DA LISTA ADMIN (Agora vivem aqui)
    safeBind('btn-refresh-admin-list', 'click', () => renderAdminTable());
    safeBind('admin-search-rnc', 'input', () => renderAdminTable());
    safeBind('admin-search-label', 'input', () => renderAdminTable());
}

// --- INTEGRAÇÃO: Recebe dados do rnc.js ---
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
    
    // Separa as listas
    let rncList = uniqueList.filter(d => d.type !== 'pallet_label_request').sort((a,b) => b.jsDate - a.jsDate);
    let labelList = uniqueList.filter(d => d.type === 'pallet_label_request').sort((a,b) => b.jsDate - a.jsDate);

    // Filtra RNC
    if (termRNC) {
        rncList = rncList.filter(item => `${item.embarque || ''} ${item.nf || ''} ${item.tipo || ''}`.toLowerCase().includes(termRNC));
    }

    // Filtra Etiquetas
    if (termLabel) {
        labelList = labelList.filter(item => `${item.item || ''} ${item.lote || ''}`.toLowerCase().includes(termLabel));
    }

    // Limita a 10 últimos
    const rncDisplay = rncList.slice(0, 10);
    const labelDisplay = labelList.slice(0, 10);

    // Render RNC
    tbodyRNC.innerHTML = '';
    if (rncDisplay.length === 0) { 
        tbodyRNC.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-center text-slate-600 italic">Sem registros recentes.</td></tr>'; 
    } else {
        rncDisplay.forEach(item => {
            const tr = document.createElement('tr'); 
            tr.className = "hover:bg-slate-800 transition-colors border-b border-slate-800/50";
            tr.innerHTML = `
                <td class="px-3 py-2 text-slate-300 font-mono text-[10px]">
                    ${item.jsDate.toLocaleDateString('pt-BR')}<br>
                    <span class="font-bold text-white">${item.tipo}</span>
                </td>
                <td class="px-3 py-2 text-slate-300 text-[10px]">
                    ${item.embarque || 'S/ Emb'}<br>
                    <span class="text-xs text-white">${item.nf || 'S/ Cliente'}</span>
                </td>
                <td class="px-3 py-2 text-right">
                    <div class="flex gap-2 justify-end">
                        <button class="text-indigo-400 hover:text-white bg-indigo-900/20 hover:bg-indigo-600 p-1.5 rounded transition btn-print-rnc" data-id="${item.id}" title="Imprimir"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg></button>
                        <button class="text-red-400 hover:text-white bg-red-900/20 hover:bg-red-600 p-1.5 rounded transition btn-del-adm" data-id="${item.id}"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                    </div>
                </td>`;
            tbodyRNC.appendChild(tr);
        });
    }

    // Render Etiquetas
    tbodyLabels.innerHTML = '';
    if (labelDisplay.length === 0) { 
        tbodyLabels.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-center text-slate-600 italic">Sem registros recentes.</td></tr>'; 
    } else {
        labelDisplay.forEach(item => {
            const tr = document.createElement('tr'); 
            tr.className = "hover:bg-slate-800 transition-colors border-b border-slate-800/50";
            tr.innerHTML = `
                <td class="px-3 py-2 text-slate-300 font-mono text-[10px]">
                    ${item.jsDate.toLocaleDateString('pt-BR')}<br>
                    ${item.jsDate.toLocaleTimeString('pt-BR')}
                </td>
                <td class="px-3 py-2 text-slate-300 text-[10px]">
                    <div class="truncate w-32 font-bold text-white" title="${item.item}">${item.item}</div>
                    <span class="text-cyan-400">Lote: ${item.lote}</span>
                </td>
                <td class="px-3 py-2 text-right">
                    <button class="text-red-400 hover:text-white bg-red-900/20 hover:bg-red-600 p-1.5 rounded transition btn-del-adm" data-id="${item.id}"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                </td>`;
            tbodyLabels.appendChild(tr);
        });
    }

    // Bindings
    // Determina o caminho atual para exclusão (Prod vs Teste)
    const currentPath = localStorage.getItem('appLog_env') === 'test' ? PATHS.test.occurrences : PATHS.prod.occurrences;

    document.querySelectorAll('.btn-del-adm').forEach(btn => { 
        btn.addEventListener('click', (e) => { 
            const id = e.currentTarget.dataset.id; 
            openConfirmModal("Excluir Definitivamente?", "Esta ação não pode ser desfeita.", async () => { 
                try { 
                    await deleteDoc(doc(globalDbForAdmin, currentPath, id)); 
                    showToast("Excluído."); 
                    closeConfirmModal(); 
                } catch(e) { console.error(e); showToast("Erro ao excluir.", "error"); } 
            }); 
        }); 
    });
    
    document.querySelectorAll('.btn-print-rnc').forEach(btn => {
        btn.addEventListener('click', (e) => printRncReport(e.currentTarget.dataset.id));
    });
}

// Funções Auxiliares
function setupProductSearch(db) {
    const btnSearch = document.getElementById('btn-search-product');
    const inputSearch = document.getElementById('product-search-input');
    const listContainer = document.getElementById('product-list-container');
    const tbody = document.getElementById('product-list-tbody');
    const msg = document.getElementById('product-search-msg');

    const doSearch = async () => {
        const term = inputSearch.value.toUpperCase().trim();
        if (term.length < 3) return showToast("Digite pelo menos 3 caracteres.", "info");
        
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
            tr.className = "border-b border-slate-800 hover:bg-slate-800";
            tr.innerHTML = `
                <td class="p-2 font-mono text-orange-300">${item.id}</td>
                <td class="p-2">
                    <div class="font-bold text-white">${item.descricao}</div>
                    <div class="text-[10px] text-gray-500">Cód: ${item.codigo}</div>
                </td>
                <td class="p-2 text-right">
                    <button class="text-red-400 hover:text-white bg-red-900/20 hover:bg-red-600 p-1.5 rounded transition btn-del-prod" data-id="${item.id}" title="Excluir">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </td>
            `;
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
    document.body.appendChild(a); a.click(); a.remove();
}

function handleImport(event, db, collectionName, processFn, statusId) {
    const file = event.target.files[0]; if (!file) return;
    const statusDiv = document.getElementById(statusId);
    const statusText = document.getElementById(`${statusId}-text`);
    statusDiv.classList.remove('hidden'); statusText.innerText = "Lendo...";
    
    const reader = new FileReader();
    reader.onload = async (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            if (!Array.isArray(data)) throw new Error("Formato inválido. Use uma lista [].");
            const batch = writeBatch(db);
            const count = await processFn(data, batch);
            if(count > 0) await batch.commit();
            showToast(`${count} itens importados.`);
            statusText.innerText = "Sucesso!";
        } catch (e) { 
            console.error(e);
            showToast("Erro na importação.", 'error'); 
            statusText.innerText = "Erro: " + e.message;
        }
        event.target.value = '';
        setTimeout(() => statusDiv.classList.add('hidden'), 4000);
    };
    reader.readAsText(file);
}