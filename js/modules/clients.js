/**
 * ARQUIVO: js/modules/clients.js
 * DESCRIÇÃO: Gestão de Clientes e Checklists.
 */

// ✅ 1. IMPORTAÇÕES NO TOPO (Padrão Obrigatório)
import { 
    onSnapshot, 
    query, 
    addDoc, 
    deleteDoc, 
    doc, 
    setDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { 
    safeBind, 
    showToast, 
    openConfirmModal, 
    closeConfirmModal, 
    formatValue, 
    printDocument, 
    renderSkeleton, 
    escapeHtml 
} from '../utils.js';

import { defaultChecklistData, checklistRowsConfig } from '../config.js';
import { getUserRole } from './auth.js';
import { registerLog } from './admin.js';

// --- ESTADO GERAL ---
let clientCache = new Map();
let currentEditingClientId = null;
let unsubscribeClients = null;
let currentCollectionRef = null;
let bindingsInitialized = false;

// =========================================================
// INICIALIZAÇÃO
// =========================================================
export function initClientsModule(collectionRef) {
    console.log("Iniciando Módulo Clientes...");
    currentCollectionRef = collectionRef;

    // Se já tinha um ouvinte ligado, desliga para não duplicar
    if (unsubscribeClients) unsubscribeClients();

    const tbody = document.getElementById('client-list-tbody');
    // Aplica o Esqueleto (Loading) enquanto carrega
    if (tbody) renderSkeleton(tbody, 2, 5);

    try {
        // Escuta em Tempo Real (Realtime)
        unsubscribeClients = onSnapshot(query(collectionRef), {
            next: (snapshot) => {
                const clients = [];
                snapshot.forEach(doc => clients.push({ id: doc.id, ...doc.data() }));
                
                // Ordena alfabeticamente
                clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                
                // Atualiza Cache Local
                clientCache.clear();
                clients.forEach(c => clientCache.set(c.id, c));
                
                filterAndRenderClients();
            },
            error: (error) => {
                console.warn("Erro ao ler clientes:", error.code);
                const tb = document.getElementById('client-list-tbody');
                if (tb) tb.innerHTML = '<tr><td colspan="2" class="px-6 py-12 text-center text-slate-500 italic">Lista indisponível (Permissão negada).</td></tr>';
            }
        });
    } catch (e) { console.error(e); }

    // Liga os botões apenas uma vez
    if (!bindingsInitialized) {
        setupClientBindings();
        bindingsInitialized = true;
    }
}

// =========================================================
// EVENTOS E BOTÕES
// =========================================================
function setupClientBindings() {
    // Busca
    safeBind('client-search', 'input', () => filterAndRenderClients());
    safeBind('clear-search-btn', 'click', () => { 
        const el = document.getElementById('client-search');
        if(el) el.value = ''; 
        filterAndRenderClients(); 
    });

    // Botão Adicionar Cliente
    safeBind('add-client-btn', 'click', () => {
        const nameInput = document.getElementById('client-name');
        if(nameInput) nameInput.value = '';
        
        const modal = document.getElementById('client-modal');
        if(modal) {
            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.remove('opacity-0'), 10);
        }
    });

    // Salvar Novo Cliente
    safeBind('client-form', 'submit', async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('client-name');
        const n = nameInput ? nameInput.value.trim() : "";
        
        if (!n) return;
        
        const btn = e.submitter || document.getElementById('client-modal-save');
        if(btn) btn.disabled = true;
        
        try {
            await addDoc(currentCollectionRef, { name: n, checklist: defaultChecklistData });
            registerLog('CRIAR_CLIENTE', n, 'Novo cliente criado');
            showToast("Cliente criado com sucesso!");
            
            const modal = document.getElementById('client-modal');
            if(modal) modal.classList.add('hidden');
        } catch(err) { 
            console.error(err);
            showToast("Erro ao criar cliente.", "error"); 
        } finally { 
            if(btn) btn.disabled = false; 
        }
    });

    // Modais e Navegação
    safeBind('client-modal-cancel', 'click', () => document.getElementById('client-modal').classList.add('hidden'));
    safeBind('client-modal-close-x', 'click', () => document.getElementById('client-modal').classList.add('hidden'));
    safeBind('view-back-btn', 'click', backToList);
    safeBind('edit-cancel-btn', 'click', backToList);

    // Salvar Edição de Checklist
    safeBind('edit-save-btn', 'click', async () => {
        if (!currentCollectionRef || !currentEditingClientId) return;
        
        const n = {};
        // Captura todos os inputs dinâmicos
        checklistRowsConfig.forEach(c => {
            const d = document.querySelector(`[data-k="${c.key}"][data-f="directa"]`)?.value || "";
            const f = document.querySelector(`[data-k="${c.key}"][data-f="fracionada"]`)?.value || "";
            const dl = document.querySelector(`[data-k="${c.key}"][data-f="directaLimit"]`)?.value || "";
            const fl = document.querySelector(`[data-k="${c.key}"][data-f="fracionadaLimit"]`)?.value || "";
            
            n[c.key] = { 直接: d, directa: d, fracionada: f, directaLimit: dl, fracionadaLimit: fl }; // Mantendo compatibilidade
        });

        try {
            await setDoc(doc(currentCollectionRef, currentEditingClientId), { checklist: n }, { merge: true });
            
            const cName = document.getElementById('edit-client-name').innerText;
            registerLog('EDITAR_CLIENTE', cName, 'Checklist alterado');
            showToast("Alterações salvas!");
            backToList();
        } catch (e) {
            console.error(e);
            showToast("Erro ao salvar.", "error");
        }
    });

    // Imprimir Checklist
    safeBind('view-print-btn', 'click', () => {
        const cName = document.getElementById('view-client-name').innerText;
        const cData = clientCache.get(currentEditingClientId)?.checklist || defaultChecklistData;
        
        let rowsHTML = '';
        checklistRowsConfig.forEach((conf, index) => {
            const r = cData[conf.key] || {};
            const isEven = index % 2 === 0 ? 'bg-slate-50' : 'bg-white';
            
            const fmt = (val) => {
                if (!val) return '<span class="text-slate-300">-</span>';
                if (val.toLowerCase() === 'sim') return '<span class="text-emerald-700 font-bold text-xs border border-emerald-200 bg-emerald-50 px-2 py-0.5 rounded">SIM</span>';
                if (val.toLowerCase() === 'não' || val.toLowerCase() === 'nao') return '<span class="text-red-700 font-bold text-xs border border-red-200 bg-red-50 px-2 py-0.5 rounded">NÃO</span>';
                return `<span class="text-slate-700 font-medium">${escapeHtml(val)}</span>`;
            };
            
            const limit = (val) => val ? `<div class="text-[9px] text-slate-500 mt-1">Limite: <span class="font-mono text-slate-700">${escapeHtml(val)}</span></div>` : '';
            
            rowsHTML += `
                <tr class="${isEven} border-b border-slate-200">
                    <td class="py-3 px-4 text-xs font-bold text-slate-700 uppercase tracking-wide border-r border-slate-200 w-1/3">${conf.label}</td>
                    <td class="py-3 px-4 text-xs border-r border-slate-200 w-1/3 align-top">${fmt(r.directa)} ${limit(r.directaLimit)}</td>
                    <td class="py-3 px-4 text-xs w-1/3 align-top">${fmt(r.fracionada)} ${limit(r.fracionadaLimit)}</td>
                </tr>`;
        });

        const content = `
            <div class="border-2 border-slate-800 rounded-lg overflow-hidden mb-6">
                <div class="bg-slate-800 text-white p-4 flex justify-between items-center">
                    <div><h1 class="text-xl font-bold uppercase tracking-wider">Requisitos de Expedição</h1><p class="text-xs text-slate-300 mt-1">Guia Operacional</p></div>
                    <div class="text-right"><div class="text-2xl font-black text-white">${escapeHtml(cName)}</div></div>
                </div>
            </div>
            <div class="mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tabela de Verificação</div>
            <table class="w-full border-collapse border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                <thead>
                    <tr class="bg-slate-100 border-b-2 border-slate-300">
                        <th class="py-3 px-4 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">Ponto de Vistoria</th>
                        <th class="py-3 px-4 text-left text-[10px] font-black text-indigo-600 uppercase tracking-wider bg-indigo-50/50">Carga Direta</th>
                        <th class="py-3 px-4 text-left text-[10px] font-black text-orange-600 uppercase tracking-wider bg-orange-50/50">Carga Fracionada</th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
            </table>
            <div class="mt-8 flex gap-8">
                <div class="flex-1 border-t border-slate-400 pt-2"><p class="text-[10px] font-bold text-slate-500 uppercase mb-4">Assinatura Motorista</p></div>
                <div class="flex-1 border-t border-slate-400 pt-2"><p class="text-[10px] font-bold text-slate-500 uppercase mb-4">Visto Expedição</p></div>
            </div>`;
            
        printDocument(`REQ-${cName}`, content);
    });
}

// =========================================================
// RENDERIZAÇÃO E FILTROS
// =========================================================
// =========================================================
// RENDERIZAÇÃO E FILTROS
// =========================================================
function filterAndRenderClients() {
    const searchEl = document.getElementById('client-search');
    const term = searchEl ? searchEl.value.toLowerCase().trim() : "";
    
    const clearBtn = document.getElementById('clear-search-btn');
    if (clearBtn) clearBtn.classList.toggle('hidden', term.length === 0);

    const list = Array.from(clientCache.values());
    const filtered = term ? list.filter(c => c.name.toLowerCase().includes(term)) : list;
    
    const tbody = document.getElementById('client-list-tbody');
    if (!tbody) return;

    // Remove listeners antigos clonando o elemento (Garbage Collection)
    const newBody = document.createElement('tbody');
    newBody.id = 'client-list-tbody';
    newBody.className = "bg-slate-800 divide-y divide-slate-700";

    if (!filtered.length) {
        newBody.innerHTML = '<tr><td colspan="2" class="px-6 py-12 text-center text-slate-500">Nenhum cliente encontrado.</td></tr>';
    } else {
        // ✅ RECUPERA PERMISSÕES ATUALIZADAS
        const userRoles = getUserRole(); 
        console.log("Permissões no Módulo Clientes:", userRoles); // Debug para você ver no console

        // Lógica de Permissão
        // Editar: ADMIN, LIDER ou INVENTARIO
        const canEdit = userRoles && (userRoles.includes('ADMIN') || userRoles.includes('LIDER') || userRoles.includes('INVENTARIO'));
        // Excluir: Apenas ADMIN
        const canDelete = userRoles && userRoles.includes('ADMIN');

        filtered.forEach(c => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-800 transition-colors border-b border-slate-700";
            
            const tdName = document.createElement('td'); 
            tdName.className = "px-6 py-4 text-sm font-medium text-white"; 
            tdName.textContent = c.name;
            
            const tdActions = document.createElement('td'); 
            tdActions.className = "px-6 py-4 text-right text-sm";
            
            const divActions = document.createElement('div'); 
            divActions.className = "flex justify-end items-center gap-4";

            const makeBtn = (text, classes, id, extraDataset = {}) => {
                const btn = document.createElement('button'); 
                btn.className = classes; 
                btn.textContent = text; 
                btn.dataset.id = id;
                for (const [key, val] of Object.entries(extraDataset)) btn.dataset[key] = val;
                return btn;
            };

            // Botão Visualizar (Sempre visível)
            divActions.appendChild(makeBtn("Visualizar", "text-slate-400 hover:text-white font-medium action-view transition-colors", c.id));
            
            if (canEdit) {
                divActions.appendChild(makeBtn("Editar", "text-indigo-400 hover:text-indigo-300 font-medium action-edit transition-colors", c.id));
            }
            if (canDelete) {
                divActions.appendChild(makeBtn("Excluir", "text-red-400 hover:text-red-300 font-medium action-delete transition-colors", c.id, { name: c.name }));
            }

            tdActions.appendChild(divActions);
            tr.append(tdName, tdActions);
            newBody.appendChild(tr);
        });
    }
    
    if(tbody.parentNode) tbody.parentNode.replaceChild(newBody, tbody);

    // Event Delegation
    newBody.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        
        const id = btn.dataset.id;
        if (btn.classList.contains('action-edit')) showEditMode(id);
        if (btn.classList.contains('action-view')) showViewMode(id);
        if (btn.classList.contains('action-delete')) {
            const name = btn.dataset.name || "Cliente";
            openConfirmModal("Excluir Cliente?", `Tem certeza que deseja remover ${name}? Essa ação não pode ser desfeita.`, async () => {
                if(!currentCollectionRef) return;
                try {
                    await deleteDoc(doc(currentCollectionRef, id));
                    registerLog('EXCLUIR_CLIENTE', name, 'Cliente removido');
                    showToast("Cliente removido.");
                    closeConfirmModal();
                } catch(err) {
                    showToast("Erro ao excluir.", "error");
                }
            });
        }
    });
}

function showViewMode(id) {
    const c = clientCache.get(id); if (!c) return;
    currentEditingClientId = id;
    document.getElementById('view-client-name').innerText = c.name;
    renderChecklistRows(document.getElementById('view-checklist-tbody'), c.checklist, false);
    
    document.getElementById('client-list-section').classList.add('hidden');
    document.getElementById('client-view-section').classList.remove('hidden');
}

function showEditMode(id) {
    const c = clientCache.get(id); if (!c) return;
    currentEditingClientId = id;
    document.getElementById('edit-client-name').innerText = c.name;
    renderChecklistRows(document.getElementById('edit-checklist-tbody'), c.checklist, true);
    
    document.getElementById('client-list-section').classList.add('hidden');
    document.getElementById('client-edit-section').classList.remove('hidden');
}

function renderChecklistRows(tbody, data, isEditable) {
    if(!tbody) return;
    tbody.innerHTML = '';
    const d = data || defaultChecklistData;
    
    checklistRowsConfig.forEach(conf => {
        const r = d[conf.key] || {};
        const tr = document.createElement('tr');
        
        // Proteção XSS aplicada nos valores para exibição
        const valDirecta = escapeHtml(r.directa || '');
        const valFracionada = escapeHtml(r.fracionada || '');
        const limitDirecta = escapeHtml(r.directaLimit || '');
        const limitFracionada = escapeHtml(r.fracionadaLimit || '');

        if (!isEditable) {
            tr.innerHTML = `
                <td class="px-6 py-4 text-sm font-medium text-slate-300 bg-slate-800 border-r border-slate-700">${conf.label}</td>
                <td class="px-6 py-4 text-sm text-slate-400 bg-blue-900/10 border-r border-slate-700">${formatValue(valDirecta, limitDirecta)}</td>
                <td class="px-6 py-4 text-sm text-slate-400 bg-orange-900/10">${formatValue(valFracionada, limitFracionada)}</td>`;
        } else {
            // Campos de Input
            const iD = conf.key === 'observacao' 
                ? `<textarea data-k="${conf.key}" data-f="directa" class="w-full bg-slate-900 border border-slate-600 text-white rounded p-2 text-sm focus:border-indigo-500 outline-none transition" rows="2">${valDirecta}</textarea>` 
                : `<input type="text" data-k="${conf.key}" data-f="directa" class="w-full bg-slate-900 border border-slate-600 text-white rounded p-2 text-sm focus:border-indigo-500 outline-none transition" value="${valDirecta}">`;
            
            const iF = conf.key === 'observacao' 
                ? `<textarea data-k="${conf.key}" data-f="fracionada" class="w-full bg-slate-900 border border-slate-600 text-white rounded p-2 text-sm focus:border-indigo-500 outline-none transition" rows="2">${valFracionada}</textarea>` 
                : `<input type="text" data-k="${conf.key}" data-f="fracionada" class="w-full bg-slate-900 border border-slate-600 text-white rounded p-2 text-sm focus:border-indigo-500 outline-none transition" value="${valFracionada}">`;
            
            const hasLimit = ['multiplosSKU', 'multiplosLotes', 'multiplosPedidos'].includes(conf.key);
            const lD = hasLimit ? `<input type="text" data-k="${conf.key}" data-f="directaLimit" class="w-full border-slate-700 bg-slate-800 text-slate-300 rounded p-1 text-xs mt-2 focus:border-slate-500 outline-none" placeholder="Limite (ex: 5)" value="${limitDirecta}">` : '';
            const lF = hasLimit ? `<input type="text" data-k="${conf.key}" data-f="fracionadaLimit" class="w-full border-slate-700 bg-slate-800 text-slate-300 rounded p-1 text-xs mt-2 focus:border-slate-500 outline-none" placeholder="Limite (ex: 5)" value="${limitFracionada}">` : '';
            
            tr.innerHTML = `
                <td class="px-4 py-4 text-sm font-medium text-slate-300 w-1/3">${conf.label}</td>
                <td class="px-4 py-4 bg-blue-900/10 w-1/3">${iD}${lD}</td>
                <td class="px-4 py-4 bg-orange-900/10 w-1/3">${iF}${lF}</td>`;
        }
        tbody.appendChild(tr);
    });
}

function backToList() {
    const editSec = document.getElementById('client-edit-section');
    const viewSec = document.getElementById('client-view-section');
    const listSec = document.getElementById('client-list-section');
    
    if(editSec) editSec.classList.add('hidden');
    if(viewSec) viewSec.classList.add('hidden');
    if(listSec) listSec.classList.remove('hidden');
}

// ✅ NOVA FUNÇÃO EXPORTADA: Permite que outros módulos peguem a lista de nomes
export function getClientNames() {
    return Array.from(clientCache.values()).map(c => c.name).sort();
}
// ✅ Permite forçar a atualização da lista (útil após login para aplicar permissões)
export function refreshClientList() {
    filterAndRenderClients();
}