/**
 * ARQUIVO: js/modules/rnc.js
 * DESCRIÇÃO: Gestão de Divergências (Versão Definitiva - Impressão Unificada).
 */

import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    onSnapshot, collection, addDoc, updateDoc, deleteDoc, doc, getDocs, getDoc, 
    query, where, orderBy, limit, writeBatch 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { safeBind, showToast, openConfirmModal, closeConfirmModal, sendDesktopNotification, requestNotificationPermission, escapeHtml } from '../utils.js';
import { PATHS } from '../config.js';
import { getUserRole, getCurrentUserName } from './auth.js';
import { initDashboard, updateDashboardView } from './dashboard.js';
import { updateAdminList, registerLog } from './admin.js';

// --- ESTADO ---
let currentCollectionRef = null;
let globalDb = null;
let bindingsInitialized = false;
let allOccurrencesData = [];
let pendingOccurrencesData = [];
let tempItemsList = []; 
let isScanning = false; 
let isSaving = false;   
let currentOccurrenceId = null;
let currentFormStatus = 'draft';
let unsubscribeOccurrences = null;

// =========================================================
// INICIALIZAÇÃO
// =========================================================
export async function initRncModule(db, isTest) {
    console.log("Iniciando Módulo RNC (Impressão Unificada)...");
    globalDb = db; 
    currentCollectionRef = collection(db, PATHS.occurrences);

    if (unsubscribeOccurrences) unsubscribeOccurrences();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const qInitial = query(
        currentCollectionRef, 
        where('createdAt', '>=', startOfMonth),
        orderBy('createdAt', 'desc')
    );

    unsubscribeOccurrences = onSnapshot(qInitial, (snapshot) => {
        allOccurrencesData = []; 
        pendingOccurrencesData = [];
        
        if (bindingsInitialized) {
            snapshot.docChanges().forEach(change => {
                if (change.type === "added" || change.type === "modified") {
                    const data = change.doc.data();
                    const isRecent = data.createdAt?.toDate ? (new Date() - data.createdAt.toDate()) < 3600000 : true;
                    if(isRecent) checkAndNotify(data);
                }
            });
        }
        
        snapshot.forEach(docSnap => {
            const d = docSnap.data(); 
            d.id = docSnap.id; 
            d.jsDate = d.createdAt?.toDate ? d.createdAt.toDate() : new Date();
            
            if (d.status === 'concluido') allOccurrencesData.push(d); 
            else pendingOccurrencesData.push(d);
        });

        allOccurrencesData.sort((a, b) => b.jsDate - a.jsDate); 
        pendingOccurrencesData.sort((a, b) => b.jsDate - a.jsDate);

        updateDashboardView([...pendingOccurrencesData, ...allOccurrencesData]);
        updateAdminList([...pendingOccurrencesData, ...allOccurrencesData]);
        updatePendingList(); 
    });

    const myCurrentRole = getUserRole() || [];
    if (myCurrentRole.includes('ADMIN') || myCurrentRole.includes('LIDER')) {
        const notificationsRef = collection(db, `artifacts/${globalDb.app.options.appId}/public/data/notifications`);
        const recentTime = new Date(Date.now() - 2 * 60 * 1000); 
        onSnapshot(query(notificationsRef, where('createdAt', '>', recentTime)), {
            next: (snapshot) => { snapshot.docChanges().forEach(change => { if (change.type === "added") { const n = change.doc.data(); if (n.requesterEmail !== getAuth().currentUser?.email) { sendDesktopNotification("📢 Chamado", `Operador ${n.requesterName} no ${n.local || 'Local'}.`); showToast(`📢 ${n.requesterName} chamando!`, "warning"); } } }); }, error: () => {}
        });
    }

    if (!bindingsInitialized) { 
        setupRncBindings(); 
        initDashboard(db); 
        requestNotificationPermission(); 
        setInterval(checkReminders, 300000); 
        bindingsInitialized = true; 
    }
}

function setupRncBindings() {
    document.querySelectorAll('.data-input, #smart-scanner-input, #req-smart-scanner').forEach(input => {
        if(input.type === 'text' || input.tagName === 'TEXTAREA') {
            input.addEventListener('input', function() { this.value = this.value.toUpperCase(); });
        }
    });

    safeBind('btn-open-pallet-req', 'click', () => { document.getElementById('ocorrencias-menu-view').classList.add('hidden'); document.getElementById('pallet-req-form').classList.remove('hidden'); resetReqForm(); });
    safeBind('btn-open-oc-novo', 'click', () => { document.getElementById('ocorrencias-menu-view').classList.add('hidden'); document.getElementById('ocorrencias-novo').classList.remove('hidden'); resetForm(); });
    safeBind('btn-back-pallet', 'click', closeReqForm);
    safeBind('btn-cancel-req', 'click', closeReqForm);
    safeBind('btn-back-oc-form', 'click', closeMainForm);
    safeBind('btn-cancel-occurrence', 'click', closeMainForm);
    
    safeBind('btn-save-req', 'click', (e) => handleSaveReq(e)); 
    safeBind('btn-save-occurrence', 'click', () => handleSave());
    safeBind('btn-reject-occurrence', 'click', () => handleReject());
    safeBind('btn-delete-permanent', 'click', () => handleDelete());
    
    safeBind('btn-add-item-list', 'click', (e) => { e.preventDefault(); addItemToTempList(); });

    safeBind('req-smart-scanner', 'change', async (e) => { const b = e.target.value.trim().toUpperCase(); if (b) { await handleReqSmartScan(b); e.target.value = ''; } });
    safeBind('smart-scanner-input', 'change', async (e) => { const b = e.target.value.trim().toUpperCase(); if (b) { await handleSmartScan(b); e.target.value = ''; } });
    safeBind('form-item-cod', 'blur', async (e) => { const code = e.target.value.trim().toUpperCase(); if (code && !isScanning) await handleSmartScan(code); });

    const tbodyRNC = document.getElementById('pending-list-tbody');
    if (tbodyRNC) tbodyRNC.addEventListener('click', (e) => { const btn = e.target.closest('.btn-open-occurrence'); if (btn) openOccurrenceForEdit(btn.dataset.id); }); 
    
    const tbodyPallet = document.getElementById('pallet-list-tbody');
    if (tbodyPallet) tbodyPallet.addEventListener('click', (e) => { 
        const btn = e.target.closest('button');
        if (btn) {
            e.stopPropagation(); 
            if (btn.classList.contains('btn-print-pallet')) handleFinishLabel(btn.dataset.id);
            if (btn.classList.contains('btn-delete-pallet')) handleDeleteLabel(btn.dataset.id);
        }
    }); 
    
    safeBind('btn-cancel-leader-auth', 'click', () => { document.getElementById('leader-auth-modal').classList.add('hidden'); document.getElementById('auth-leader-pin').value = ''; });
    safeBind('btn-confirm-leader-auth', 'click', () => submitLeaderAuth());
    safeBind('btn-call-leader-remote', 'click', callLeaderRemote);
}

// =================================================================
// LÓGICA DE SOLICITAÇÃO DE PALETE
// =================================================================
async function handleSaveReq(e) {
    if(e) e.preventDefault(); 
    const btn = document.getElementById('btn-save-req'); 
    
    const embarque = document.getElementById('req-embarque').value.toUpperCase();
    const box = document.getElementById('req-box').value.toUpperCase();
    const checkout = document.getElementById('req-checkout').value.toUpperCase();
    const item = document.getElementById('req-item').value.toUpperCase();
    const lote = document.getElementById('req-lote').value.toUpperCase();
    const qtd = document.getElementById('req-qtd').value;

    if (!item || !qtd) { showToast("Preencha Item e Quantidade.", "error"); return; }
    
    const data = { 
        embarque, box, checkout, item, lote, qtd, 
        status: 'pendente', createdAt: new Date(), type: 'pallet_label_request' 
    };

    try {
        btn.disabled = true; btn.innerText = "Enviando..."; 
        await addDoc(currentCollectionRef, data); 
        showToast("Solicitação enviada!"); closeReqForm(); 
    } catch (err) { console.error(err); showToast("Erro ao enviar.", "error"); } finally { btn.disabled = false; btn.innerText = "Enviar Solicitação"; }
}

async function handleDeleteLabel(id) {
    openConfirmModal("Excluir Solicitação?", "Isso removerá o pedido da lista.", async () => {
        try {
            await deleteDoc(doc(currentCollectionRef, id));
            showToast("Solicitação excluída.");
            closeConfirmModal();
        } catch (err) {
            console.error(err);
            showToast("Erro ao excluir.", "error");
        }
    });
}

// =================================================================
// LÓGICA MULTI-ITEM
// =================================================================

function addItemToTempList() {
    const tipo = document.querySelector('input[name="oc_tipo"]:checked')?.value;
    const local = document.querySelector('input[name="oc_local"]:checked')?.value;
    const itemCod = document.getElementById('form-item-cod').value.toUpperCase();
    const itemDesc = document.getElementById('form-item-desc').value.toUpperCase();
    const itemLote = document.getElementById('form-item-lote').value.toUpperCase();
    const itemQtd = document.getElementById('form-item-qtd').value;
    const itemEnd = document.getElementById('form-item-end').value.toUpperCase();

    if (!tipo) return showToast("Selecione o TIPO.", "error");
    if (!local) return showToast("Selecione o LOCAL.", "error");
    if (!itemCod) return showToast("Informe o CÓDIGO.", "error");
    if (!itemQtd) return showToast("Informe a QTD.", "error");

    if (tempItemsList.length >= 20) return showToast("Limite de itens atingido.", "warning");

    const item = {
        id: Date.now(),
        tipo,
        local,
        item_cod: itemCod,
        item_desc: itemDesc,
        item_lote: itemLote,
        item_qtd: itemQtd,
        item_end: itemEnd
    };

    tempItemsList.push(item);
    renderTempItems();
    
    document.getElementById('form-item-cod').value = '';
    document.getElementById('form-item-desc').value = '';
    document.getElementById('form-item-lote').value = '';
    document.getElementById('form-item-qtd').value = '';
    document.getElementById('form-item-end').value = '';
    document.getElementById('smart-scanner-input').focus();
    
    showToast(`Adicionado! (${tempItemsList.length})`);
}

function removeTempItem(id) {
    tempItemsList = tempItemsList.filter(i => i.id !== id);
    renderTempItems();
    showToast("Item removido.");
}

function updateItemQty(id, newQty) {
    const index = tempItemsList.findIndex(i => i.id === id);
    if (index !== -1) {
        tempItemsList[index].item_qtd = newQty;
    }
}

function renderTempItems() {
    const container = document.getElementById('items-list-container');
    const tbody = document.getElementById('temp-items-tbody');
    const badge = document.getElementById('items-count-badge');
    
    if(badge) badge.innerText = tempItemsList.length;
    
    if (tempItemsList.length === 0) {
        if(container) container.classList.add('hidden');
        if(tbody) tbody.innerHTML = '';
        return;
    }
    
    if(container) container.classList.remove('hidden');
    
    const myRole = getUserRole() || [];
    const isInventory = myRole.includes('INVENTARIO') || myRole.includes('ADMIN');
    const canEdit = currentFormStatus === 'draft' || (currentFormStatus === 'pendente_inventario' && isInventory);

    if(tbody) {
        tbody.innerHTML = tempItemsList.map(item => {
            let colorClass = "text-slate-400";
            if(item.tipo === 'FALTA') colorClass = "text-red-400 font-bold";
            if(item.tipo === 'SOBRA') colorClass = "text-blue-400 font-bold";
            if(item.tipo === 'AVARIA') colorClass = "text-amber-400 font-bold";

            const deleteBtn = canEdit ? `
                <button type="button" class="text-red-500 hover:text-white hover:bg-red-600/20 p-2 rounded transition btn-remove-temp" data-id="${item.id}" title="Excluir">
                    <svg class="w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            ` : `<span class="text-slate-600 text-[10px]">LOCKED</span>`;

            const qtyDisplay = canEdit ? `
                <input type="number" value="${item.item_qtd}" class="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-center text-white text-sm focus:border-indigo-500 outline-none qty-input" data-id="${item.id}">
            ` : `<div class="text-white font-bold text-sm bg-slate-800/50 rounded border border-slate-700/50 py-1">${item.item_qtd}</div>`;

            return `
            <tr class="border-b border-slate-800 hover:bg-slate-800 transition-colors">
                <td class="p-3">
                    <div class="${colorClass} text-[10px] uppercase tracking-wide">${item.tipo}</div>
                    <div class="text-slate-500 text-[10px]">${item.local}</div>
                </td>
                <td class="p-3 text-white font-medium text-xs">
                    <span class="block text-indigo-300 font-mono">${item.item_cod}</span>
                    <span class="block truncate max-w-[150px]">${escapeHtml(item.item_desc)}</span>
                </td>
                <td class="p-3 text-center">
                    ${qtyDisplay}
                </td>
                <td class="p-3 text-right w-16">
                    ${deleteBtn}
                </td>
            </tr>`;
        }).join('');

        if (canEdit) {
            tbody.querySelectorAll('.btn-remove-temp').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.preventDefault(); e.stopPropagation();
                    removeTempItem(Number(this.dataset.id));
                });
            });
            tbody.querySelectorAll('.qty-input').forEach(input => {
                input.addEventListener('change', function(e) {
                    updateItemQty(Number(this.dataset.id), this.value);
                });
            });
        }
    }
}

// =================================================================
// SCANNER & BUSCA
// =================================================================
function parseGS1(barcode) {
    let dun = ""; let lote = ""; let raw = barcode.replace(/[()]/g, ''); 
    if (raw.startsWith('01')) { dun = raw.substring(2, 16); raw = raw.substring(16); } 
    else if (raw.length >= 14 && !isNaN(raw.substring(0,14))) { dun = barcode.substring(0, 14); }
    let loops = 0;
    while (loops < 5 && raw.length > 0) { 
        if (raw.startsWith('11') || raw.startsWith('13') || raw.startsWith('17')) { raw = raw.substring(8); } 
        else if (raw.startsWith('10')) { lote = raw.substring(2); break; } 
        else { break; } loops++;
    }
    if (!lote) { const match = barcode.replace(/[()]/g, '').match(/10([a-zA-Z0-9]+)$/); if (match) lote = match[1]; }
    return { dun, lote };
}

async function handleSmartScan(barcode) {
    if (isScanning) return; 
    let { dun, lote } = parseGS1(barcode);
    if (!dun) dun = barcode.trim(); 
    if (lote) { const el = document.getElementById('form-item-lote'); if(el){ el.value = lote; highlightField(el); } }
    if (dun && globalDb) {
        isScanning = true; showToast(`Buscando...`, "info");
        const elCod = document.getElementById('form-item-cod'); 
        const elDesc = document.getElementById('form-item-desc');
        try {
            const docRef = doc(globalDb, "products", dun);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) { 
                const prod = docSnap.data(); 
                elCod.value = (prod.codigo || dun).toUpperCase(); 
                elDesc.value = (prod.descricao || "").toUpperCase(); 
                highlightField(elCod); highlightField(elDesc); showToast("Encontrado!"); 
            } else { 
                const q = query(collection(globalDb, 'products'), where('codigo', '==', dun));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const prod = snap.docs[0].data();
                    elCod.value = (prod.codigo || dun).toUpperCase();
                    elDesc.value = (prod.descricao || "").toUpperCase();
                    highlightField(elCod); highlightField(elDesc); showToast("Encontrado!");
                } else {
                    elCod.value = dun.toUpperCase(); 
                    if(!elDesc.value) { elDesc.value = ""; elDesc.placeholder = "DIGITE A DESCRIÇÃO"; }
                    showToast("Novo produto.", "warning"); 
                }
            }
        } catch (e) { console.error(e); } finally { isScanning = false; }
    }
    const qtd = document.getElementById('form-item-qtd'); if(qtd) qtd.focus();
}

async function handleReqSmartScan(barcode) {
    if (isScanning) return; 
    let { dun, lote } = parseGS1(barcode);
    if (!dun) dun = barcode.trim();
    if (lote) { const el = document.getElementById('req-lote'); if(el){ el.value = lote; highlightField(el); } }
    if (dun && globalDb) {
        isScanning = true; showToast(`Verificando...`, "info");
        try {
            const docRef = doc(globalDb, "products", dun);
            const docSnap = await getDoc(docRef);
            const elItem = document.getElementById('req-item');
            if (docSnap.exists()) { 
                const prod = docSnap.data(); 
                elItem.value = `${prod.codigo} - ${prod.descricao}`.toUpperCase(); 
                highlightField(elItem); showToast("OK!"); 
            } else { 
                const q = query(collection(globalDb, 'products'), where('codigo', '==', dun));
                const snap = await getDocs(q);
                if(!snap.empty) {
                    const prod = snap.docs[0].data();
                    elItem.value = `${prod.codigo} - ${prod.descricao}`.toUpperCase();
                    highlightField(elItem); showToast("OK!");
                } else {
                    elItem.value = dun.toUpperCase(); showToast("Não cadastrado.", "error"); 
                }
            }
        } catch (e) { console.error(e); } finally { isScanning = false; }
    }
    const qtd = document.getElementById('req-qtd'); if(qtd) qtd.focus();
}

function highlightField(el) { if(el) { el.classList.add('bg-indigo-900/50', 'text-indigo-200'); setTimeout(() => el.classList.remove('bg-indigo-900/50', 'text-indigo-200'), 1000); } }

// === SALVAMENTO ===
async function handleSave() {
    if (isSaving) return;
    if (currentFormStatus === 'draft') {
        const assColab = document.getElementById('form-ass-colab').value;
        if (!assColab.trim()) return showToast("Assine como Colaborador.", "error");
        
        const itemCod = document.getElementById('form-item-cod').value;
        if (tempItemsList.length === 0 && !itemCod) return showToast("Preencha ao menos um item.", "error");

        const pinField = document.getElementById('auth-leader-pin');
        const modal = document.getElementById('leader-auth-modal');
        pinField.value = ''; modal.classList.remove('hidden'); setTimeout(() => pinField.focus(), 50); 
        return; 
    }
    processSaveData();
}

async function processSaveData() {
    const btn = document.getElementById('btn-save-occurrence');
    const originalText = btn.innerHTML;
    try {
        isSaving = true; btn.disabled = true; btn.innerText = "Salvando...";

        const headerData = {
            updatedAt: new Date(), 
            embarque: document.getElementById('form-embarque').value.toUpperCase(), 
            nf: document.getElementById('form-nf').value.toUpperCase(), 
            dataRef: document.getElementById('form-data').value, 
            obs: document.getElementById('form-obs').value.toUpperCase(),
            emb_amassada: document.getElementById('check-amassada').checked, 
            emb_rasgada: document.getElementById('check-rasgada').checked, 
            emb_vazamento: document.getElementById('check-vazamento').checked, 
            emb_outros: document.getElementById('form-outros-emb').value.toUpperCase(),
            infrator: document.getElementById('form-infrator').value.toUpperCase(),
            ass_colab: document.getElementById('form-ass-colab').value.toUpperCase(), 
            ass_lider: document.getElementById('form-ass-lider').value.toUpperCase(), 
            ass_inv: document.getElementById('form-ass-inv').value.toUpperCase()
        };

        let newStatus = currentFormStatus;
        if (currentFormStatus === 'draft') { newStatus = 'pendente_inventario'; headerData.createdAt = new Date(); }
        else if (currentFormStatus === 'pendente_lider') { newStatus = 'pendente_inventario'; }
        else if (currentFormStatus === 'pendente_inventario') { 
            if (!headerData.ass_inv.trim()) throw new Error("Assinatura Inventário obrigatória."); 
            newStatus = 'concluido'; 
        }
        headerData.status = newStatus;

        // VERIFICAÇÃO DE ITEM SOLTO 
        const lastItemCod = document.getElementById('form-item-cod').value;
        if (lastItemCod && lastItemCod !== "VÁRIOS ITENS" && lastItemCod !== "VARIOS ITENS") {
            tempItemsList.push({
                tipo: document.querySelector('input[name="oc_tipo"]:checked')?.value || "N/A",
                local: document.querySelector('input[name="oc_local"]:checked')?.value || "N/A",
                item_cod: lastItemCod.toUpperCase(),
                item_desc: document.getElementById('form-item-desc').value.toUpperCase(),
                item_lote: document.getElementById('form-item-lote').value.toUpperCase(),
                item_qtd: document.getElementById('form-item-qtd').value,
                item_end: document.getElementById('form-item-end').value.toUpperCase()
            });
        }

        const docPayload = {
            ...headerData,
            items: tempItemsList, 
            tipo: tempItemsList[0]?.tipo || 'VÁRIOS',
            local: tempItemsList[0]?.local || 'VÁRIOS',
            item_cod: tempItemsList.length > 1 ? 'VÁRIOS ITENS' : tempItemsList[0]?.item_cod,
            item_desc: tempItemsList.length > 1 ? `LOTE DE ${tempItemsList.length} ITENS` : tempItemsList[0]?.item_desc
        };

        if (currentOccurrenceId) await updateDoc(doc(currentCollectionRef, currentOccurrenceId), docPayload);
        else await addDoc(currentCollectionRef, docPayload);

        showToast("Salvo!"); 
        closeMainForm();

    } catch(e) { console.error(e); showToast(e.message, "error"); } 
    finally { isSaving = false; btn.disabled = false; btn.innerHTML = originalText; }
}

// === INTERFACE DE LISTAGEM ===
function updatePendingList() {
    const tbodyRNC = document.getElementById('pending-list-tbody');
    const tbodyPallet = document.getElementById('pallet-list-tbody');
    const rncItems = pendingOccurrencesData.filter(item => item.type !== 'pallet_label_request');
    const palletItems = pendingOccurrencesData.filter(item => item.type === 'pallet_label_request');

    if (tbodyRNC) {
        tbodyRNC.innerHTML = '';
        if (rncItems.length === 0) { 
            tbodyRNC.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500 italic">Nada pendente.</td></tr>'; 
        } else {
            rncItems.forEach(item => {
                const tr = document.createElement('tr');
                tr.className = "border-b border-slate-700 hover:bg-slate-750 transition-colors";
                
                let badge = '';
                let btnText = '';
                
                if (item.status === 'draft' && item.ass_lider) { 
                    badge = '<span class="px-2 py-1 rounded bg-amber-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-amber-900/50 animate-pulse">CORREÇÃO</span>';
                    btnText = 'Corrigir';
                } else if (item.status === 'draft') {
                    badge = '<span class="px-2 py-1 rounded bg-slate-700 text-slate-300 border border-slate-600 text-[10px] font-bold uppercase">RASCUNHO</span>';
                    btnText = 'Continuar';
                } else if (item.status === 'pendente_lider') {
                    badge = '<span class="badge-pending">Aguard. Líder</span>';
                    btnText = 'Assinar (Líder)';
                } else {
                    badge = '<span class="badge-blue">Aguard. Inv.</span>';
                    btnText = 'Validar (Inv.)';
                }

                let tipoDisplay = item.tipo;
                let descDisplay = item.item_desc || item.nf || '-';
                if (item.items && item.items.length > 1) {
                    tipoDisplay = `<span class="text-purple-400 font-bold">MÚLTIPLOS (${item.items.length})</span>`;
                    descDisplay = `<span class="text-xs text-slate-400">Vários Itens no Lote</span>`;
                }

                tr.innerHTML = `
                    <td class="px-4 py-3 text-slate-300 font-mono text-xs">${item.jsDate.toLocaleDateString('pt-BR')}</td>
                    <td class="px-4 py-3 text-white font-medium">${item.embarque || '-'} <br> <span class="text-[10px] text-slate-500">${item.nf || ''}</span></td>
                    <td class="px-4 py-3 text-slate-300 text-xs">${tipoDisplay}<br>${descDisplay}</td>
                    <td class="px-4 py-3">${badge}</td>
                    <td class="px-4 py-3 text-right">
                        <button class="text-indigo-400 hover:text-white text-xs font-bold uppercase tracking-wide bg-indigo-900/30 px-3 py-1.5 rounded border border-indigo-500/30 hover:bg-indigo-600 transition-all btn-open-occurrence" data-id="${item.id}">${btnText}</button>
                    </td>`;
                tbodyRNC.appendChild(tr);
            });
        }
    }
    
    // ✅ ATUALIZAÇÃO: TABELA DE PALETES
    if (tbodyPallet) {
        tbodyPallet.innerHTML = '';
        
        const myRole = getUserRole() || [];
        const canDelete = myRole.includes('INVENTARIO') || myRole.includes('ADMIN') || myRole.includes('LIDER');
        const canFinish = myRole.includes('INVENTARIO') || myRole.includes('ADMIN');

        if (palletItems.length === 0) {
            tbodyPallet.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500 italic">Nenhuma solicitação pendente.</td></tr>'; 
        } else {
            palletItems.forEach(item => { 
                const tr = document.createElement('tr'); 
                tr.className = "border-b border-slate-700 hover:bg-slate-750 transition-colors"; 
                
                const deleteBtn = canDelete ? `<button class="text-red-500 hover:text-white hover:bg-red-900/30 p-2 rounded ml-2 btn-delete-pallet" data-id="${item.id}" title="Excluir"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>` : '';
                const finishBtn = canFinish ? `<button class="border border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded transition-all btn-print-pallet" data-id="${item.id}">OK</button>` : `<span class="text-[10px] text-slate-500 italic px-2">Aguardando</span>`;

                let localInfo = '-';
                if(item.box) localInfo = `BOX: ${item.box}`;
                if(item.checkout) localInfo = `CHK: ${item.checkout}`;
                if(item.box && item.checkout) localInfo = `BOX: ${item.box} / CHK: ${item.checkout}`;

                tr.innerHTML = `
                    <td class="px-6 py-3 text-slate-300 font-mono text-xs">
                        ${item.jsDate.toLocaleDateString('pt-BR')}<br>
                        ${item.jsDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}
                    </td>
                    <td class="px-6 py-3 text-white text-xs font-bold text-indigo-300">
                        ${item.item || '-'}
                    </td>
                    <td class="px-6 py-3 text-white text-xs text-slate-400">
                        ${item.lote || '-'}
                    </td>
                    <td class="px-6 py-3 text-cyan-400 font-bold text-lg text-center">
                        ${item.qtd}
                    </td>
                    <td class="px-6 py-3 text-white text-xs">
                        ${item.embarque || '-'}
                    </td>
                    <td class="px-6 py-3 text-white text-xs">
                        ${localInfo}
                    </td>
                    <td class="px-6 py-3 text-right flex items-center justify-end gap-2 h-full">
                        ${finishBtn}
                        ${deleteBtn}
                    </td>`; 
                tbodyPallet.appendChild(tr); 
            }); 
        } 
    }
}

function updateFormStateUI() {
    const status = currentFormStatus; 
    const inputColab = document.getElementById('form-ass-colab'), inputLider = document.getElementById('form-ass-lider'), inputInv = document.getElementById('form-ass-inv');
    const btnSave = document.getElementById('btn-save-occurrence'), btnReject = document.getElementById('btn-reject-occurrence'), btnDelete = document.getElementById('btn-delete-permanent'); 
    const btnAdd = document.getElementById('btn-add-item-list');
    const listContainer = document.getElementById('items-list-container');

    if(!inputColab) return;
    
    inputColab.disabled = true; inputLider.disabled = true; inputInv.disabled = true; 
    btnReject.classList.add('hidden'); btnDelete.classList.add('hidden'); btnSave.classList.remove('hidden');
    
    const myRole = getUserRole() || [];
    const isInventory = myRole.includes('INVENTARIO') || myRole.includes('ADMIN');
    
    if (currentFormStatus === 'draft' || isInventory) {
        if(btnAdd) btnAdd.classList.remove('hidden');
    } else {
        if(btnAdd) btnAdd.classList.add('hidden');
    }
    
    if(listContainer && tempItemsList.length > 0) listContainer.classList.remove('hidden');

    const myName = getCurrentUserName();

    if (status === 'draft') {
        document.getElementById('form-status-bar').innerText = "Etapa 1: Abertura e Validação";
        inputColab.disabled = false; if (!inputColab.value) inputColab.value = myName; 
        inputLider.disabled = false; inputLider.value = ""; inputLider.placeholder = "Líder: Assine aqui para validar"; 
        inputInv.value = ""; inputInv.placeholder = "Habilita na Etapa Final"; 
        btnSave.innerHTML = `Validar e Enviar p/ Inventário`;
        if(currentOccurrenceId) { btnDelete.classList.remove('hidden'); }
    } else if (status === 'pendente_inventario') {
        document.getElementById('form-status-bar').innerText = "Etapa 3: Validação do Inventário";
        if (isInventory) { 
            inputInv.disabled = false; inputInv.value = myName; btnSave.innerText = "Validar e Finalizar"; btnReject.classList.remove('hidden'); btnDelete.classList.remove('hidden'); btnDelete.innerText = "Excluir RD"; 
        } else { 
            inputInv.value = ""; inputInv.placeholder = "Aguardando Inventário..."; btnSave.classList.add('hidden'); showToast("Aguardando validação do Inventário.", "info"); 
        }
    }
}

// ... Compatibilidade ...
async function submitLeaderAuth() { const pin = document.getElementById('auth-leader-pin').value.trim(); if (!pin) return showToast("Digite PIN.", "error"); const btn = document.getElementById('btn-confirm-leader-auth'); btn.disabled = true; try { const q = query(collection(globalDb, 'users'), where('pin', '==', pin)); const s = await getDocs(q); if (s.empty) { showToast("PIN inválido.", "error"); btn.disabled = false; return; } const u = s.docs[0].data(); if (!String(u.role).toUpperCase().includes('LIDER') && String(u.role).toUpperCase() !== 'ADMIN') { showToast("Sem permissão.", "error"); btn.disabled = false; return; } document.getElementById('form-ass-lider').value = u.name; document.getElementById('leader-auth-modal').classList.add('hidden'); processSaveData(); } catch (e) { console.error(e); } finally { btn.disabled = false; } }
async function callLeaderRemote() { const btn = document.getElementById('btn-call-leader-remote'); btn.disabled = true; try { await addDoc(collection(globalDb, `artifacts/${globalDb.app.options.appId}/public/data/notifications`), { type: 'leader_call', requesterName: getCurrentUserName() || "Op", requesterEmail: getAuth().currentUser?.email, createdAt: new Date(), read: false }); showToast("Chamado enviado!"); setTimeout(() => btn.disabled = false, 10000); } catch (e) { console.error(e); btn.disabled = false; } }
async function handleReject() { openConfirmModal("Devolver?", "Volta para rascunho.", async () => { try { await updateDoc(doc(currentCollectionRef, currentOccurrenceId), { status: 'draft', ass_lider: '', ass_inv: '', updatedAt: new Date() }); showToast("Devolvido."); registerLog('REJEITAR_RNC', currentOccurrenceId, 'Devolvido'); closeConfirmModal(); closeMainForm(); } catch { showToast("Erro.", "error"); } }); }
async function handleDelete() { openConfirmModal("Excluir?", "Irreversível.", async () => { try { await deleteDoc(doc(currentCollectionRef, currentOccurrenceId)); showToast("Excluído."); registerLog('EXCLUIR_RNC', currentOccurrenceId, 'Excluído'); closeConfirmModal(); closeMainForm(); } catch { showToast("Erro.", "error"); } }); }
function openOccurrenceForEdit(id) { 
    const item = [...pendingOccurrencesData, ...allOccurrencesData].find(d => d.id === id); 
    if (!item) return; 
    currentOccurrenceId = item.id; 
    currentFormStatus = item.status; 
    
    document.getElementById('form-item-cod').value = ""; 
    document.getElementById('form-item-desc').value = ""; 
    document.getElementById('form-item-lote').value = ""; 
    document.getElementById('form-item-qtd').value = ""; 
    document.getElementById('form-item-end').value = "";

    if (item.items && Array.isArray(item.items)) { tempItemsList = item.items; } 
    else { tempItemsList = [{ id: Date.now(), tipo: item.tipo, local: item.local, item_cod: item.item_cod, item_desc: item.item_desc, item_lote: item.item_lote, item_qtd: item.item_qtd, item_end: item.item_end }]; }
    renderTempItems();
    
    const mapIds = {'form-embarque':item.embarque,'form-nf':item.nf,'form-obs':item.obs,'form-outros-emb':item.emb_outros,'form-infrator':item.infrator,'form-ass-colab':item.ass_colab,'form-ass-lider':item.ass_lider,'form-ass-inv':item.ass_inv}; for (const [k, v] of Object.entries(mapIds)) { const el = document.getElementById(k); if(el) el.value = v || ''; } if(item.dataRef) document.getElementById('form-data').value = item.dataRef; if(document.getElementById('check-amassada')) document.getElementById('check-amassada').checked = item.emb_amassada; if(document.getElementById('check-rasgada')) document.getElementById('check-rasgada').checked = item.emb_rasgada; if(document.getElementById('check-vazamento')) document.getElementById('check-vazamento').checked = item.emb_vazamento; updateFormStateUI(); document.getElementById('ocorrencias-menu-view').classList.add('hidden'); document.getElementById('ocorrencias-novo').classList.remove('hidden'); 
}
async function handleFinishLabel(id) { openConfirmModal("Concluir?", "Marcar como entregue.", async () => { try { await updateDoc(doc(currentCollectionRef, id), { status: 'concluido', updatedAt: new Date() }); showToast("Concluído!"); closeConfirmModal(); } catch(err) { console.error(err); } }); }
function closeReqForm() { document.getElementById('pallet-req-form').classList.add('hidden'); document.getElementById('ocorrencias-menu-view').classList.remove('hidden'); }
function closeMainForm() { document.getElementById('ocorrencias-novo').classList.add('hidden'); document.getElementById('ocorrencias-menu-view').classList.remove('hidden'); }
function resetReqForm() { ['req-embarque','req-box','req-checkout','req-item','req-lote','req-qtd','req-smart-scanner'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; }); document.getElementById('req-smart-scanner').focus(); }
function resetForm() { currentOccurrenceId = null; currentFormStatus = 'draft'; tempItemsList = []; renderTempItems(); ['form-embarque','form-nf','form-obs','form-outros-emb','form-infrator','form-ass-colab','form-ass-lider','form-ass-inv','form-item-cod','form-item-desc','form-item-lote','form-item-qtd','form-item-end'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; }); document.getElementById('form-data').valueAsDate = new Date(); document.querySelectorAll('input[type="checkbox"]').forEach(el => el.checked = false); document.querySelectorAll('input[name="oc_tipo"]').forEach(r => r.checked = false); document.querySelectorAll('input[name="oc_local"]').forEach(r => r.checked = false); updateFormStateUI(); }

// =================================================================
// 🔥 LÓGICA DE IMPRESSÃO GLOBAL (PARA O DASHBOARD USAR)
// =================================================================

// Função Principal que será chamada
async function executePrint(id) {
    // Se o ID for um objeto (evento de clique), pegamos o dataset
    if (typeof id === 'object' && id.dataset) id = id.dataset.id;
    
    if (!id || !globalDb) {
        console.error("Print Error: ID ou DB inválido", id, globalDb);
        return;
    }

    try {
        const docRef = doc(globalDb, PATHS.occurrences, id);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) { showToast("Registro não encontrado.", "error"); return; }
        const data = docSnap.data();
        data.id = docSnap.id;
        generatePrintLayoutGlobal(data);
    } catch (e) { console.error(e); showToast("Erro ao imprimir.", "error"); }
}

// Expõe GLOBALMENTE com os nomes que o Dashboard pode estar usando
window.printRncReport = executePrint;
window.printOccurrence = executePrint;

function generatePrintLayoutGlobal(data) {
    const printWindow = window.open('', '_blank');
    const dateOpts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const dateStr = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString('pt-BR', dateOpts) : new Date().toLocaleDateString('pt-BR');
    const ocurrenceDate = data.dataRef ? new Date(data.dataRef).toLocaleDateString('pt-BR', dateOpts) : dateStr;

    let productsHtml = '';
    const hasItemsArray = data.items && Array.isArray(data.items) && data.items.length > 0;

    if (hasItemsArray) {
        // --- MODO TABELA (Igual ao Admin) ---
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
        // --- MODO LEGADO (Item Único) ---
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
            .check-box.checked { background: #0f172a; border-color: #0f172a; color: white; }.signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 50px; border-top: 2px solid #e2e8f0; padding-top: 30px; }.sig-block { text-align: center; }.sig-line { border-bottom: 1px solid #0f172a; margin-bottom: 8px; height: 30px; display: flex; align-items: flex-end; justify-content: center; font-family: 'Courier New', monospace; font-size: 12px; font-weight: bold; }.sig-label { font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase; }@media print { body { padding: 0; margin: 20px; } .no-print { display: none; } }</style></head><body><div class="header"><div class="logo"><h1>AppLog</h1><p>Gestão de Qualidade & Estoque</p></div><div class="meta">ID: ${data.id}<br>Emissão: ${new Date().toLocaleString('pt-BR')}<br>REF: ${(data.embarque || 'N/A')}</div></div><div class="title-box"><h2>Relatório de Divergência</h2><div class="status-badge">${statusText}</div></div><div class="section"><div class="section-title">Informações Gerais</div><div class="info-grid"><div class="field"><label>Data Ocorrência</label><div>${ocurrenceDate}</div></div><div class="field"><label>Embarque</label><div>${data.embarque || '-'}</div></div><div class="field"><label>Cliente / NF</label><div>${data.nf || '-'}</div></div><div class="field"><label>Infrator / Origem</label><div>${data.infrator || 'N/A'}</div></div></div></div><div class="section"><div class="section-title">Detalhamento da Ocorrência</div>${productsHtml}</div><div class="section"><div class="info-grid" style="grid-template-columns: 1fr 1fr;"><div><div class="section-title">Condição da Embalagem</div><div class="checkbox-group"><div class="check-item"><div class="check-box ${data.emb_amassada ? 'checked' : ''}">${data.emb_amassada ? '✓' : ''}</div> Amassada</div><div class="check-item"><div class="check-box ${data.emb_rasgada ? 'checked' : ''}">${data.emb_rasgada ? '✓' : ''}</div> Rasgada</div><div class="check-item"><div class="check-box ${data.emb_vazamento ? 'checked' : ''}">${data.emb_vazamento ? '✓' : ''}</div> Vazamento</div></div>${data.emb_outros ? `<div style="margin-top: 8px; font-size: 11px;">Outros: <b>${data.emb_outros}</b></div>` : ''}</div><div><div class="section-title">Observações / Relato</div><div style="font-size: 12px; color: #334155; line-height: 1.4;">${data.obs || 'Nenhuma observação registrada.'}</div></div></div></div><div class="signatures"><div class="sig-block"><div class="sig-line">${data.ass_colab || ''}</div><div class="sig-label">Reportado Por</div></div><div class="sig-block"><div class="sig-line">${data.ass_lider || ''}</div><div class="sig-label">Validação Liderança</div></div><div class="sig-block"><div class="sig-line">${data.ass_inv || ''}</div><div class="sig-label">Conclusão Inventário</div></div></div><script>window.onload = function() { window.print(); }</script></body></html>`;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
}