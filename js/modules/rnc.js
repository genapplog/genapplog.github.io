/**
 * ARQUIVO: js/modules/rnc.js
 * DESCRIÇÃO: Gestão de Divergências, Etiquetas e Notificações (Core).
 */
import { onSnapshot, collection, addDoc, updateDoc, deleteDoc, doc, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { safeBind, showToast, openConfirmModal, closeConfirmModal, sendDesktopNotification, requestNotificationPermission } from '../utils.js';
import { PATHS } from '../config.js';
import { getUserRole, getCurrentUserName } from './auth.js';
// Importação dos Módulos Satélites
import { initDashboard, updateDashboardView } from './dashboard.js';
import { updateAdminList } from './admin.js';

// --- ESTADO DO MÓDULO ---
let currentCollectionRef = null;
let globalDb = null;
let bindingsInitialized = false;

// Listas Locais
let allOccurrencesData = [];
let pendingOccurrencesData = [];

// Controles de Estado (Travas)
let isScanning = false; 
let isSaving = false;   

// Edição de Formulário
let currentOccurrenceId = null;
let currentFormStatus = 'draft';
let unsubscribeOccurrences = null;

export async function initRncModule(db, isTest) {
    globalDb = db; 
    const PROD_OC_PATH = PATHS.prod.occurrences;
    const path = isTest ? PATHS.test.occurrences : PROD_OC_PATH;
    
    currentCollectionRef = collection(db, path);

    if (unsubscribeOccurrences) unsubscribeOccurrences();

    unsubscribeOccurrences = onSnapshot(currentCollectionRef, (snapshot) => {
        allOccurrencesData = []; 
        pendingOccurrencesData = []; 
        
        if (bindingsInitialized) {
            snapshot.docChanges().forEach(change => {
                if (change.type === "added" || change.type === "modified") {
                    checkAndNotify(change.doc.data());
                }
            });
        }
        
        snapshot.forEach(docSnap => {
            const d = docSnap.data(); 
            d.id = docSnap.id; 
            d.jsDate = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt || Date.now());
            
            if (d.status === 'concluido') allOccurrencesData.push(d); 
            else pendingOccurrencesData.push(d); 
        });

        allOccurrencesData.sort((a, b) => b.jsDate - a.jsDate); 
        pendingOccurrencesData.sort((a, b) => b.jsDate - a.jsDate);

        // 1. Envia para Dashboard (Gráficos)
        updateDashboardView([...pendingOccurrencesData, ...allOccurrencesData]);
        
        // 2. Envia para Admin (Área de Perigo / Tabelas Gerais)
        updateAdminList([...pendingOccurrencesData, ...allOccurrencesData]);

        // 3. Atualiza lista local (Operação Pendente)
        updatePendingList(); 
    });

    if (!bindingsInitialized) {
        setupRncBindings();
        initDashboard(); 
        requestNotificationPermission();
        setInterval(checkReminders, 300000);
        bindingsInitialized = true;
    }
}

function setupRncBindings() {
    console.log("Iniciando Bindings do RNC (Completo)...");

    // --- 1. MENUS E FORMULÁRIOS ---
    safeBind('btn-open-pallet-req', 'click', () => {
        document.getElementById('ocorrencias-menu-view').classList.add('hidden');
        document.getElementById('pallet-req-form').classList.remove('hidden');
        resetReqForm();
    });
    safeBind('btn-open-oc-novo', 'click', () => { 
        document.getElementById('ocorrencias-menu-view').classList.add('hidden'); 
        document.getElementById('ocorrencias-novo').classList.remove('hidden'); 
        resetForm(); 
    });
    safeBind('btn-back-pallet', 'click', closeReqForm);
    safeBind('btn-cancel-req', 'click', closeReqForm);
    safeBind('btn-back-oc-form', 'click', () => { 
        document.getElementById('ocorrencias-novo').classList.add('hidden'); 
        document.getElementById('ocorrencias-menu-view').classList.remove('hidden'); 
    });
    safeBind('btn-cancel-occurrence', 'click', () => { 
        document.getElementById('ocorrencias-novo').classList.add('hidden'); 
        document.getElementById('ocorrencias-menu-view').classList.remove('hidden'); 
    });

    // --- 2. AÇÕES ---
    safeBind('btn-save-req', 'click', handleSaveReq);
    safeBind('btn-save-occurrence', 'click', () => handleSave());
    safeBind('btn-reject-occurrence', 'click', () => handleReject());
    safeBind('btn-delete-permanent', 'click', () => handleDelete());

    // --- 3. SCANNERS ---
    safeBind('req-smart-scanner', 'change', async (e) => { const b = e.target.value.trim(); if (b) { await handleReqSmartScan(b); e.target.value = ''; } });
    safeBind('smart-scanner-input', 'change', async (e) => { const b = e.target.value.trim(); if (b) { await handleSmartScan(b); e.target.value = ''; } });

    // --- 4. LISTAS PENDENTES ---
    const tbodyRNC = document.getElementById('pending-list-tbody');
    if (tbodyRNC) { 
        tbodyRNC.addEventListener('click', (e) => { 
            const btn = e.target.closest('.btn-open-occurrence'); 
            if (btn) openOccurrenceForEdit(btn.dataset.id); 
        }); 
    }
    const tbodyPallet = document.getElementById('pallet-list-tbody');
    if (tbodyPallet) { 
        tbodyPallet.addEventListener('click', (e) => { 
            const btn = e.target.closest('.btn-print-pallet'); 
            if (btn) handleFinishLabel(btn.dataset.id); 
        }); 
    }
}

// =================================================================
// LÓGICA DE NEGÓCIO
// =================================================================

function checkAndNotify(data) {
    const myRole = getUserRole(); 
    const myName = getCurrentUserName();
    
    if (data.status === 'pendente_lider' && (myRole === 'LIDER' || myRole === 'ADMIN')) { 
        if (data.ass_colab !== myName) sendDesktopNotification("Nova Pendência", `RNC de ${data.tipo} aguardando aprovação.`); 
    }
    if (data.status === 'pendente_inventario' && (myRole === 'INVENTARIO' || myRole === 'ADMIN')) { 
        if (data.ass_lider !== myName) sendDesktopNotification("Atenção Inventário", `Líder aprovou RNC. Validação necessária.`); 
    }
    if (data.type === 'pallet_label_request' && data.status === 'pendente' && (myRole === 'INVENTARIO' || myRole === 'ADMIN')) { 
        sendDesktopNotification("Nova Etiqueta", "Solicitação de etiqueta pendente."); 
    }
}

function checkReminders() {
    const myRole = getUserRole(); 
    const myName = getCurrentUserName(); 
    let count = 0;
    pendingOccurrencesData.forEach(item => {
        if (item.status === 'pendente_lider' && (myRole === 'LIDER' || myRole === 'ADMIN')) { if (item.ass_colab !== myName) count++; }
        if (item.status === 'pendente_inventario' && (myRole === 'INVENTARIO' || myRole === 'ADMIN')) { if (item.ass_lider !== myName) count++; }
        if (item.type === 'pallet_label_request' && item.status === 'pendente' && (myRole === 'INVENTARIO' || myRole === 'ADMIN')) count++;
    });
    if (count > 0) sendDesktopNotification("Lembrete AppLog", `Existem ${count} pendências.`);
}

function parseGS1(barcode) {
    let dun = ""; let lote = ""; let raw = barcode.replace(/[()]/g, ''); 
    if (raw.startsWith('01')) { dun = raw.substring(2, 16); raw = raw.substring(16); } else if (raw.length >= 14 && !isNaN(raw.substring(0,14))) { dun = barcode.substring(0, 14); }
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
    
    const { dun, lote } = parseGS1(barcode);
    if (lote) { 
        const el = document.getElementById('form-item-lote'); 
        if(el){ el.value = lote; highlightField(el); } 
    }
    
    if (dun && globalDb) {
        isScanning = true;
        showToast(`Buscando produto...`, "info");
        try {
            const docRef = doc(globalDb, "products", dun);
            const docSnap = await getDoc(docRef);
            const elCod = document.getElementById('form-item-cod'); 
            const elDesc = document.getElementById('form-item-desc');
            
            if (docSnap.exists()) { 
                const prod = docSnap.data(); 
                elCod.value = prod.codigo || dun; 
                elDesc.value = prod.descricao || ""; 
                highlightField(elCod); 
                highlightField(elDesc); 
                showToast("Produto encontrado!"); 
            } else { 
                elCod.value = dun; 
                elDesc.value = ""; 
                elDesc.placeholder = "Não cadastrado"; 
                showToast("Produto não cadastrado.", "error"); 
            }
        } catch (e) { console.error(e); } 
        finally { isScanning = false; }
    }
    const qtd = document.getElementById('form-item-qtd'); 
    if(qtd) qtd.focus();
}

async function handleReqSmartScan(barcode) {
    if (isScanning) return; 
    
    const { dun, lote } = parseGS1(barcode);
    if (lote) { 
        const el = document.getElementById('req-lote'); 
        if(el){ el.value = lote; highlightField(el); } 
    }

    if (dun && globalDb) {
        isScanning = true;
        showToast(`Verificando cadastro...`, "info");
        try {
            const docRef = doc(globalDb, "products", dun);
            const docSnap = await getDoc(docRef);
            const elItem = document.getElementById('req-item');
            
            if (docSnap.exists()) { 
                const prod = docSnap.data(); 
                elItem.value = `${prod.codigo} - ${prod.descricao}`; 
                highlightField(elItem); 
                showToast("Produto identificado!"); 
            } else { 
                elItem.value = dun; 
                showToast("Produto não cadastrado.", "error"); 
            }
        } catch (e) { console.error(e); } 
        finally { isScanning = false; }
    }
    const qtd = document.getElementById('req-qtd'); 
    if(qtd) qtd.focus();
}

function highlightField(el) { if(el) { el.classList.add('bg-indigo-900/50', 'text-indigo-200'); setTimeout(() => el.classList.remove('bg-indigo-900/50', 'text-indigo-200'), 1000); } }

function updatePendingList() {
    const tbodyRNC = document.getElementById('pending-list-tbody');
    const tbodyPallet = document.getElementById('pallet-list-tbody');
    const rncItems = pendingOccurrencesData.filter(item => item.type !== 'pallet_label_request');
    const palletItems = pendingOccurrencesData.filter(item => item.type === 'pallet_label_request');

    if (tbodyRNC) {
        tbodyRNC.innerHTML = '';
        if (rncItems.length === 0) { tbodyRNC.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500 italic">Nenhuma divergência pendente.</td></tr>'; }
        else {
            const uniqueList = Array.from(new Map(rncItems.map(item => [item.id, item])).values());
            uniqueList.forEach(item => {
                const tr = document.createElement('tr'); tr.className = "border-b border-slate-700 hover:bg-slate-750 transition-colors";
                let statusBadge = item.status === 'pendente_lider' ? '<span class="badge-pending">Aguard. Líder</span>' : item.status === 'pendente_inventario' ? '<span class="badge-blue">Aguard. Inventário</span>' : '<span class="text-xs text-slate-500">Rascunho</span>';
                let actionText = item.status === 'pendente_lider' ? 'Assinar (Líder)' : item.status === 'pendente_inventario' ? 'Revisar e Finalizar' : 'Ver Detalhes';
                const displayNF = item.nf ? item.nf : '-';
                tr.innerHTML = `<td class="px-4 py-3 text-slate-300 font-mono text-xs">${item.jsDate.toLocaleDateString('pt-BR')}</td><td class="px-4 py-3 text-white font-medium">${item.embarque || '-'} / ${displayNF}</td><td class="px-4 py-3 text-slate-300 text-xs">${item.tipo}</td><td class="px-4 py-3">${statusBadge}</td><td class="px-4 py-3 text-right"><button class="text-indigo-400 hover:text-white text-xs font-bold uppercase tracking-wide bg-indigo-900/30 px-3 py-1.5 rounded border border-indigo-500/30 hover:bg-indigo-600 hover:border-indigo-500 transition-all btn-open-occurrence" data-id="${item.id}">${actionText}</button></td>`;
                tbodyRNC.appendChild(tr);
            });
        }
    }

    if (tbodyPallet) {
        tbodyPallet.innerHTML = '';
        if (palletItems.length === 0) { tbodyPallet.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500 italic">Nenhuma solicitação pendente.</td></tr>'; }
        else {
            palletItems.forEach(item => {
                const tr = document.createElement('tr'); tr.className = "border-b border-slate-700 hover:bg-slate-750 transition-colors";
                let localInfo = []; if(item.embarque) localInfo.push(`Emb: ${item.embarque}`); if(item.box) localInfo.push(`Box: ${item.box}`); if(item.checkout) localInfo.push(`Chk: ${item.checkout}`);
                const localStr = localInfo.join(' / ') || '-';
                let prodStr = `<span class="font-bold text-white">${item.item || '-'}</span>`; if(item.lote) prodStr += ` <span class="text-slate-400 text-xs ml-2 font-normal">(Lote: ${item.lote})</span>`;
                tr.innerHTML = `<td class="px-6 py-4 text-slate-300 font-mono text-xs border-b border-slate-700/50">${item.jsDate.toLocaleDateString('pt-BR')} ${item.jsDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</td><td class="px-6 py-4 text-slate-200 text-sm border-b border-slate-700/50">${localStr}</td><td class="px-6 py-4 border-b border-slate-700/50">${prodStr}</td><td class="px-6 py-4 text-cyan-400 font-bold text-lg border-b border-slate-700/50">${item.qtd}</td><td class="px-6 py-4 text-right border-b border-slate-700/50"><button class="border border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded transition-all btn-print-pallet" data-id="${item.id}">CONCLUIR</button></td>`;
                tbodyPallet.appendChild(tr);
            });
        }
    }
}

async function handleFinishLabel(id) {
    openConfirmModal("Concluir Solicitação?", "A etiqueta será marcada como entregue.", async () => { try { await updateDoc(doc(currentCollectionRef, id), { status: 'concluido', updatedAt: new Date() }); showToast("Etiqueta concluída!"); closeConfirmModal(); } catch(err) { console.error(err); } });
}

function closeReqForm() { document.getElementById('pallet-req-form').classList.add('hidden'); document.getElementById('ocorrencias-menu-view').classList.remove('hidden'); }
function resetReqForm() { ['req-embarque','req-box','req-checkout','req-item','req-lote','req-qtd','req-smart-scanner'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; }); document.getElementById('req-smart-scanner').focus(); }

async function handleSaveReq() {
    const btn = document.getElementById('btn-save-req'); const data = { embarque: document.getElementById('req-embarque').value, box: document.getElementById('req-box').value, checkout: document.getElementById('req-checkout').value, item: document.getElementById('req-item').value, lote: document.getElementById('req-lote').value, qtd: document.getElementById('req-qtd').value, status: 'pendente', createdAt: new Date(), type: 'pallet_label_request' };
    if (!data.item || !data.qtd) { showToast("Preencha Item e Quantidade.", "error"); return; }
    btn.disabled = true; btn.innerText = "Enviando..."; try { await addDoc(currentCollectionRef, data); showToast("Solicitação enviada!"); closeReqForm(); } catch (e) { console.error(e); showToast("Erro.", "error"); } finally { btn.disabled = false; btn.innerHTML = `Enviar Solicitação`; }
}

function resetForm() { currentOccurrenceId = null; currentFormStatus = 'draft'; const ids = ['form-embarque','form-nf','form-obs','form-outros-emb','form-item-cod','form-item-desc','form-item-lote','form-item-qtd','form-item-end','form-infrator','form-ass-colab','form-ass-lider','form-ass-inv']; ids.forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; }); const dateEl = document.getElementById('form-data'); if(dateEl) dateEl.valueAsDate = new Date(); const checks = ['check-amassada','check-rasgada','check-vazamento']; checks.forEach(id => { const el = document.getElementById(id); if(el) el.checked = false; }); document.querySelectorAll('input[name="oc_tipo"]').forEach(r => r.checked = false); document.querySelectorAll('input[name="oc_local"]').forEach(r => r.checked = false); updateFormStateUI(); }

async function handleSave() {
    if (isSaving) return;
    const btn = document.getElementById('btn-save-occurrence');
    const originalText = btn.innerHTML;

    try {
        isSaving = true; btn.disabled = true; btn.innerText = "Processando...";

        const data = {
            updatedAt: new Date(), 
            embarque: document.getElementById('form-embarque').value, nf: document.getElementById('form-nf').value, dataRef: document.getElementById('form-data').value, 
            tipo: document.querySelector('input[name="oc_tipo"]:checked')?.value || "N/A", local: document.querySelector('input[name="oc_local"]:checked')?.value || "N/A", obs: document.getElementById('form-obs').value,
            emb_amassada: document.getElementById('check-amassada').checked, emb_rasgada: document.getElementById('check-rasgada').checked, emb_vazamento: document.getElementById('check-vazamento').checked, emb_outros: document.getElementById('form-outros-emb').value,
            item_cod: document.getElementById('form-item-cod').value, item_desc: document.getElementById('form-item-desc').value, item_lote: document.getElementById('form-item-lote').value, item_qtd: document.getElementById('form-item-qtd').value, item_end: document.getElementById('form-item-end').value, infrator: document.getElementById('form-infrator').value,
            ass_colab: document.getElementById('form-ass-colab').value, ass_lider: document.getElementById('form-ass-lider').value, ass_inv: document.getElementById('form-ass-inv').value
        };

        let newStatus = currentFormStatus;
        if (currentFormStatus === 'draft') { 
            if (!data.ass_colab.trim()) throw new Error("Assinatura obrigatória."); 
            if(!data.tipo || data.tipo === "N/A") throw new Error("Selecione o Tipo."); 
            newStatus = 'pendente_lider'; data.createdAt = new Date(); 
        }
        else if (currentFormStatus === 'pendente_lider') { if (!data.ass_lider.trim()) throw new Error("Assinatura obrigatória."); newStatus = 'pendente_inventario'; }
        else if (currentFormStatus === 'pendente_inventario') { if (!data.ass_inv.trim()) throw new Error("Assinatura obrigatória."); newStatus = 'concluido'; }
        
        data.status = newStatus;

        if (currentOccurrenceId) await updateDoc(doc(currentCollectionRef, currentOccurrenceId), data); 
        else await addDoc(currentCollectionRef, data);

        showToast("Relatório salvo!"); 
        document.getElementById('ocorrencias-novo').classList.add('hidden'); 
        document.getElementById('ocorrencias-menu-view').classList.remove('hidden');

    } catch(e) { console.error(e); showToast(e.message || "Erro.", "error"); } 
    finally { isSaving = false; btn.disabled = false; btn.innerHTML = originalText; }
}

function updateFormStateUI() {
    const status = currentFormStatus; const dataInputs = document.querySelectorAll('.data-input'); const inputColab = document.getElementById('form-ass-colab'), inputLider = document.getElementById('form-ass-lider'), inputInv = document.getElementById('form-ass-inv'), inputInfrator = document.getElementById('form-infrator'); const btnSave = document.getElementById('btn-save-occurrence'), btnReject = document.getElementById('btn-reject-occurrence'), btnDelete = document.getElementById('btn-delete-permanent'); const statusBar = document.getElementById('form-status-bar'); const myRole = getUserRole(); const myName = getCurrentUserName();
    if(!inputColab) return;
    inputColab.disabled = true; inputLider.disabled = true; inputInv.disabled = true; dataInputs.forEach(input => input.disabled = false); btnReject.classList.add('hidden'); btnDelete.classList.add('hidden'); btnSave.classList.remove('hidden');
    if (status === 'draft') {
        statusBar.innerText = "Etapa 1: Preenchimento Inicial"; statusBar.className = "bg-indigo-900/40 text-indigo-200 px-4 py-3 text-xs font-bold uppercase tracking-wider text-center border-b border-indigo-500/20";
        inputInfrator.disabled = true; inputInfrator.placeholder = "Reservado ao Inventário"; inputInfrator.classList.add('opacity-50'); inputColab.disabled = false; if (!inputColab.value) inputColab.value = myName; inputLider.value = ""; inputLider.placeholder = "Habilita após envio da Etapa 1"; inputInv.value = ""; inputInv.placeholder = "Habilita na Etapa 3"; btnSave.innerHTML = `Assinar e Enviar`;
        if(currentOccurrenceId) { btnDelete.classList.remove('hidden'); btnDelete.innerText = "Excluir Rascunho"; }
    } else if (status === 'pendente_lider') {
        statusBar.innerText = "Etapa 2: Aprovação do Líder"; statusBar.className = "bg-amber-900/40 text-amber-200 px-4 py-3 text-xs font-bold uppercase tracking-wider text-center border-b border-amber-500/20"; dataInputs.forEach(input => input.disabled = true);
        if (myRole === 'LIDER' || myRole === 'ADMIN') { inputLider.disabled = false; inputLider.value = myName; btnSave.innerText = "Aprovar e Enviar"; btnReject.classList.remove('hidden'); btnDelete.classList.remove('hidden'); btnDelete.innerText = "Excluir RNC"; } else { inputLider.value = ""; inputLider.placeholder = "Aguardando Líder..."; btnSave.classList.add('hidden'); showToast("Aguardando aprovação da liderança.", "info"); }
    } else if (status === 'pendente_inventario') {
        statusBar.innerText = "Etapa 3: Validação do Inventário"; statusBar.className = "bg-blue-900/40 text-blue-200 px-4 py-3 text-xs font-bold uppercase tracking-wider text-center border-b border-blue-500/20"; dataInputs.forEach(input => input.disabled = false);
        if (myRole === 'INVENTARIO' || myRole === 'ADMIN') { inputInfrator.disabled = false; inputInfrator.classList.remove('opacity-50'); inputInv.disabled = false; inputInv.value = myName; btnSave.innerText = "Validar e Finalizar"; btnReject.classList.remove('hidden'); btnDelete.classList.remove('hidden'); btnDelete.innerText = "Excluir RNC"; } else { inputInv.value = ""; inputInv.placeholder = "Aguardando Inventário..."; btnSave.classList.add('hidden'); showToast("Aguardando validação do Inventário.", "info"); }
    }
}

async function handleReject() { openConfirmModal("Solicitar Correção?", "O relatório voltará para rascunho.", async () => { try { if (!currentOccurrenceId) return; await updateDoc(doc(currentCollectionRef, currentOccurrenceId), { status: 'draft', ass_lider: '', ass_inv: '', updatedAt: new Date() }); showToast("Devolvido para correção."); closeConfirmModal(); document.getElementById('ocorrencias-novo').classList.add('hidden'); document.getElementById('ocorrencias-menu-view').classList.remove('hidden'); } catch { showToast("Erro ao rejeitar.", "error"); } }); }
async function handleDelete() { openConfirmModal("Excluir Definitivamente?", "Esta ação não pode ser desfeita.", async () => { try { if (!currentOccurrenceId) return; await deleteDoc(doc(currentCollectionRef, currentOccurrenceId)); showToast("Excluído."); closeConfirmModal(); document.getElementById('ocorrencias-novo').classList.add('hidden'); document.getElementById('ocorrencias-menu-view').classList.remove('hidden'); } catch { showToast("Erro ao excluir.", "error"); } }); }

function openOccurrenceForEdit(id) {
    const item = [...pendingOccurrencesData, ...allOccurrencesData].find(d => d.id === id);
    if (!item) return;

    currentOccurrenceId = item.id;
    currentFormStatus = item.status;

    const mapIds = {
        'form-embarque': item.embarque, 'form-nf': item.nf, 'form-obs': item.obs, 'form-outros-emb': item.emb_outros,
        'form-item-cod': item.item_cod, 'form-item-desc': item.item_desc, 'form-item-lote': item.item_lote, 'form-item-qtd': item.item_qtd, 'form-item-end': item.item_end,
        'form-infrator': item.infrator, 'form-ass-colab': item.ass_colab, 'form-ass-lider': item.ass_lider, 'form-ass-inv': item.ass_inv
    };

    for (const [eid, val] of Object.entries(mapIds)) { const el = document.getElementById(eid); if (el) el.value = val || ''; }
    
    const dateEl = document.getElementById('form-data'); if (dateEl && item.dataRef) dateEl.value = item.dataRef;
    const radioTipo = document.querySelector(`input[name="oc_tipo"][value="${item.tipo}"]`); if (radioTipo) radioTipo.checked = true;
    const radioLocal = document.querySelector(`input[name="oc_local"][value="${item.local}"]`); if (radioLocal) radioLocal.checked = true;

    if (document.getElementById('check-amassada')) document.getElementById('check-amassada').checked = item.emb_amassada;
    if (document.getElementById('check-rasgada')) document.getElementById('check-rasgada').checked = item.emb_rasgada;
    if (document.getElementById('check-vazamento')) document.getElementById('check-vazamento').checked = item.emb_vazamento;

    updateFormStateUI();
    document.getElementById('ocorrencias-menu-view').classList.add('hidden');
    document.getElementById('ocorrencias-novo').classList.remove('hidden');
}